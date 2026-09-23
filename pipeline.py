#!/usr/bin/env python3
"""
Street Watch — job ingestion pipeline (v0.2)
============================================

Pulls REAL current postings from firms' own hiring systems:
  • Greenhouse  (public GET JSON)
  • Ashby       (public GET JSON)
  • Workday     (public POST JSON, paginated)

Filters to Analyst/Associate-level roles (wider titles for market-makers) in
NY+JC / SF / Chicago, de-dupes, flags what's NEW since the last run, writes
street_watch_jobs.json + .csv, and — if SUPABASE_URL + SUPABASE_SERVICE_KEY
are set — upserts every row into a Supabase `jobs` table.

Runs anywhere egress is open (laptop, GitHub Actions, a VM, Supabase edge fn).
It will NOT run inside the Claude workspace (network locked to registries).

    pip install requests
    python pipeline.py
"""
from __future__ import annotations
import csv, json, os, re, sys, time
from datetime import datetime, timezone, timedelta
import requests

UA = {"User-Agent": "street-watch/0.2 (personal job tracker)"}
TIMEOUT = 25

# ---------------------------------------------------------------- registries
GREENHOUSE = {   # firm -> board token  (boards-api.greenhouse.io/v1/boards/<token>/jobs)
    "Jane Street": "janestreet", "DRW": "drweng", "IMC Trading": "imc",
    "Virtu Financial": "virtu", "Optiver": "optiverprivate",
    "General Atlantic": "generalatlantic",
    "TPG": "tpgcareers", "Warburg Pincus": "warburgpincusllc",
    "iCapital": "icapitalnetwork", "CAIS": "cais", "BTIG": "btig27",
    "StepStone": "stepstone",                       # confirmed live (private markets)
    "KKR": "stage",                                 # KKR embeds Greenhouse board token "stage"
    "William Blair": "williamblair", "EQT": "eqtpartners",
    "Ducera Partners": "ducerapartners", "LionTree": "liontree",
    # Consulting firms (added 2026-09-17 at client request) — both expose the
    # standard public Greenhouse board JSON on the US host.
    "Mars & Co": "marscousg",                        # NY-area consulting roles only
    "Altman Solon": "altmansolonuslp",               # TMT strategy; US + EU board
    "Solomon Partners": "solomonpartnersprofessionals",  # yellow-tier (advisory)
}
ASHBY = {        # firm -> job board name (api.ashbyhq.com/posting-api/job-board/<name>)
    "Insight Partners": "insight-partners",          # slug is hyphenated (was "insightpartners" = empty)
}
JIBE = {         # firm -> careers host  (https://<host>/api/jobs — Jibe/iCIMS front)
    "ZS Associates": "jobs.zs.com",                 # 275 postings, paginated 10/page
    "Susquehanna International Group": "careers.sig.com",  # trading firm; 265 postings
}
PINPOINT = {     # firm -> careers host  (https://<host>/postings.json — Pinpoint ATS)
    "CIL Management Consultants": "careers.cil.com", # small board; Analyst NY/Chicago
}
ORACLE = {       # firm -> (host, siteNumber, siteName)  Oracle Fusion Recruiting (CE)
    # Public REST at /hcmRestApi/resources/latest/recruitingCEJobRequisitions.
    # siteNumber (CX_n) selects the career site; siteName builds the public URL.
    "Lazard": ("icbpjb.fa.ocs.oraclecloud.com", "CX_1", "LazardProfessionalCareers"),
    "Cantor Fitzgerald": ("hdow.fa.us6.oraclecloud.com", "CX_1003", "CX_1003"),  # 85 reqs
    # JPMorgan runs the same Oracle Fusion CE product (added 2026-09-18). ~7,400
    # reqs globally; fetch_oracle's 5000 offset ceiling still covers the whole
    # <=30-day window (by offset ~4800 postings are already >40 days old).
    "JPMorgan Chase": ("jpmc.fa.oraclecloud.com", "CX_1001", "CX_1001"),
}
ICIMS = {        # firm -> host  (careers-<x>.icims.com; server-rendered JobCardItems)
    "Stifel": "careers-stifel.icims.com",            # also carries KBW (Stifel co.)
}
HRMDIRECT = {    # firm -> host  (ClearCompany/HRM Direct; opco.hrmdirect.com/employment)
    "Oppenheimer & Co.": "opco.hrmdirect.com",       # filter by &city=; NY 26 / Chi / SF
}
PAGEUP = {       # firm -> (host, locale)  PageUp People (server-rendered SearchJobs)
    "Macquarie Group": ("recruitment.macquarie.com", "en_US"),  # ~588 reqs, 9/page
}
WORKDAY = {      # firm -> (tenant, datacenter, site)
    "Blackstone":               ("blackstone", "wd1", "Blackstone_Careers"),
    "Apollo Global Management": ("athene",     "wd5", "Apollo_Careers"),
    "Blue Owl Capital":         ("blueowl",    "wd1", "blueowl"),
    "Ares Management":          ("aresmgmt",   "wd1", "External"),
    "Morgan Stanley":           ("ms",         "wd5", "External"),
    "Houlihan Lokey":           ("hl",         "wd1", "Lateral"),
    "Wells Fargo":              ("wf",         "wd1", "WellsFargoJobs"),
    "Moelis & Company":         ("moelis",     "wd1", "Experienced-Hires"),
    "Brookfield Asset Management":("brookfield","wd5", "brookfield"),
    "Oaktree Capital Management":("oaktree",   "wd1", "Oaktree"),
    "Neuberger Berman":         ("nb",         "wd1", "NBCareers"),
    "Deutsche Bank":            ("db",         "wd3", "DBWebsite"),
    "Bank of America":          ("ghr",        "wd1", "Lateral-US"),
    "PGIM":                     ("pru",        "wd5", "PGIM_Careers"),
    "Invesco":                  ("invesco",    "wd1", "IVZ"),
    "Wellington Management":    ("wellington", "wd5", "External"),
    "Guggenheim Securities":    ("guggenheiminvestment", "wd5", "External"),
    "State Street":             ("statestreet","wd1", "Global"),
    "Baird":                    ("baird",      "wd1", "Careers"),
    "BMO":                      ("bmo",        "wd3", "External"),
    "TD Bank":                  ("td",         "wd3", "TD_Bank_Careers"),
    "CIBC":                     ("cibc",       "wd3", "search"),
    "Northern Trust":           ("ntrs",       "wd1", "northerntrust"),
    "Capital One":              ("capitalone", "wd12","Capital_One"),
    "U.S. Bancorp":             ("usbank",     "wd1", "US_Bank_Careers"),
    "KeyBank":                  ("keybank",    "wd5", "External_Career_Site"),
    "M&T Bank":                 ("mtb",        "wd5", "MTB"),
    # Green-priority PE firms (added 2026-09-17) — tenant/site read off the live
    # careers redirect and confirmed against the wd/cxs endpoint.
    "Carlyle":                  ("carlyle",    "wd1", "Carlyle"),        # 79 reqs
    "Ardian":                   ("ardian",     "wd103", "ArdianCareers"),# 74 reqs
    # Yellow-priority batch (added 2026-09-17).
    "AllianceBernstein":        ("abglobal",   "wd1", "alliancebernsteincareers"),
    "Hamilton Lane":            ("hamiltonlane","wd108", "search"),
    "Piper Sandler":            ("pipersandler","wd501", "Piper_Sandler_Careers"),  # 57
    # Moved off dead Greenhouse boards to their real Workday tenants (2026-09-18).
    "Sixth Street":             ("sixthstreet", "wd1", "SixthStreetCareers"),  # 15 reqs
    "PJT Partners":             ("pjtpartners", "wd1", "Careers"),             # 52 reqs
    # Best-effort tenant/site slugs from public careers URLs — a wrong site just
    # logs an error for that firm and skips it; correct it from the run output.
    # Still to map (custom / not-yet-found ATS): Evercore, Centerview, Rothschild,
    #   Nomura, HSBC, UBS, BNP, SocGen, PIMCO, HPS. (JPMorgan -> Oracle CE above;
    #   RBC -> Phenom; Jefferies -> Talentlink behind Cloudflare, needs cloudscraper.)
}

# ---------------------------------------------------------------- filters
METROS = {
    # City-name substrings. NY's state-code is handled separately by _NY_STATE_RE
    # below — a bare "manhattan"/", ny" substring wrongly matched Manhattan, KS
    # ("US-KS-Manhattan") and missed "NY, United States", so the standalone-token
    # regex replaces both.
    "NY + Jersey City": ["new york", "jersey city", "nyc"],
    "SF / Bay Area":    ["san francisco", "bay area", "palo alto", "menlo park",
                         "mountain view", "san mateo", "redwood city"],
    "Chicago":          ["chicago", ", il", "illinois"],
}
# Standalone "NY" state code — matches "New York, NY", "NY, United States" and
# ATS forms like "US-NY-New York", but never "Albany"/"Germany"/"Sunnyvale"
# (the \b boundaries require NY to stand alone between non-word chars).
_NY_STATE_RE = re.compile(r'\bny\b', re.I)
# "consultant" added 2026-09-17 so consulting firms' entry level (Analyst /
# Associate Consultant / Consultant) is captured; senior grades are still cut by
# EXCLUDE (principal/director/…). Banks rarely title junior roles "consultant".
TITLES         = ["analyst", "associate", "consultant"]
TITLES_TRADING = TITLES + ["trader", "trading", "quantitative researcher",
                           "quant researcher", "graduate", "new grad"]
TRADING_FIRMS  = {"Jane Street", "DRW", "IMC Trading", "Virtu Financial",
                  "Optiver", "Citadel Securities", "Susquehanna International Group"}
EXCLUDE = ["intern", "internship", "summer", "vice president", " vp ", " vp,",
           "director", "managing director", " md,", "principal", "head of",
           "co-op", "co op"]

STATE_FILE = ".street_watch_state.json"
NEWSLETTER_SENT_KEY = "__newsletter_sent__"   # state-file key: UTC date of the last delivered newsletter


# ---------------------------------------------------------------- fetchers
def _posted(val):
    """Normalize an ISO timestamp to a YYYY-MM-DD date string, else None.
    (Supabase `posted_date` is a DATE column; nulls are fine.)"""
    if not val or not isinstance(val, str) or len(val) < 10:
        return None
    d = val[:10]
    return d if d[:4].isdigit() and d[4] == "-" else None


_WD_POSTED_RE = re.compile(r'posted\s+(\d+)\s*\+?\s*day', re.I)


def _workday_posted(posted_on):
    """Turn Workday's relative `postedOn` label into an approximate YYYY-MM-DD.
    The CXS list payload never carries an absolute date — only a relative string,
    and only on tenants configured to expose it (MS does; Blackstone omits it):
      "Posted Today" / "Posted Yesterday" / "Posted N Days Ago" /
      "Posted 30+ Days Ago"  — its only bucketed form; everything 0-29 is exact.
    Map Today->0, Yesterday->1, "N Days"->N, and "30+"->31 so anything Workday has
    collapsed into 30+ lands just over the 30-day line and gets aged out. Tenants
    that omit `postedOn` yield None -> row kept (undated), exactly as before."""
    if not posted_on:
        return None
    s = posted_on.strip().lower()
    if "today" in s:
        days = 0
    elif "yesterday" in s:
        days = 1
    else:
        m = _WD_POSTED_RE.search(s)
        if not m:
            return None
        days = int(m.group(1)) + (1 if "+" in s else 0)  # "30+" -> at least 31
    return (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()


def fetch_greenhouse(firm, token):
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs"
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT); r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ! greenhouse {firm}: {e}", file=sys.stderr); return []
    out = []
    for j in data.get("jobs", []):
        out.append(dict(firm=firm, id=f"gh-{token}-{j.get('id')}",
                        title=(j.get("title") or "").strip(),
                        location=(j.get("location", {}) or {}).get("name", "").strip(),
                        url=j.get("absolute_url", ""), source="greenhouse",
                        posted_date=_posted(j.get("first_published"))))
    return out


def fetch_ashby(firm, name):
    url = f"https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=false"
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT); r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ! ashby {firm}: {e}", file=sys.stderr); return []
    out = []
    for j in data.get("jobs", []):
        out.append(dict(firm=firm, id=f"ashby-{name}-{j.get('id')}",
                        title=(j.get("title") or "").strip(),
                        location=(j.get("location") or "").strip(),
                        url=j.get("jobUrl") or j.get("applyUrl", ""), source="ashby",
                        posted_date=_posted(j.get("publishedAt"))))
    return out


def fetch_jibe(firm, host):
    """Jibe/iCIMS-fronted careers sites (e.g. ZS at jobs.zs.com). The board serves
    a clean paginated JSON API at /api/jobs; each row's fields live under `data`,
    with `full_location` a "City, State; City, State" string and a `posted_date`
    ISO timestamp. Public job URL is https://<host>/jobs/<slug>. Pages 10 at a
    time until `totalCount` is reached (guarded so a bad payload can't loop)."""
    base = f"https://{host}/api/jobs"
    out, page, total = [], 1, None
    try:
        while page <= 200:  # hard ceiling; ZS is ~28 pages
            params = {"page": page, "sortBy": "relevance",
                      "descending": "false", "internal": "false"}
            r = requests.get(base, headers=UA, params=params, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            if total is None:
                total = data.get("totalCount") or data.get("count") or 0
            rows = data.get("jobs", []) or []
            if not rows:
                break
            for row in rows:
                d = row.get("data", row) or {}
                slug = str(d.get("slug") or d.get("req_id") or "")
                loc = (d.get("full_location") or d.get("location_name")
                       or ", ".join(x for x in [d.get("city"), d.get("state"),
                                                d.get("country")] if x)).strip()
                out.append(dict(firm=firm, id=f"jibe-{host}-{slug}",
                                title=(d.get("title") or "").strip(),
                                location=loc,
                                url=f"https://{host}/jobs/{slug}", source="jibe",
                                posted_date=_posted(d.get("posted_date"))))
            page += 1
            if total and page * 10 > total + 10:  # covered the reported total
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! jibe {firm}: {e}", file=sys.stderr)
    return out


def fetch_pinpoint(firm, host):
    """Pinpoint ATS boards (e.g. CIL at careers.cil.com). GET /postings.json
    returns every live posting in one shot under `data`; `location` is a nested
    object (name/city/province) and `url` is the public posting URL. Pinpoint's
    list payload carries no reliable post date, so posted_date is left null (the
    row is kept — same treatment as Workday/Radancy)."""
    out = []
    try:
        r = requests.get(f"https://{host}/postings.json", headers=UA, timeout=TIMEOUT)
        r.raise_for_status()
        for p in (r.json() or {}).get("data", []) or []:
            loc = p.get("location") or {}
            loc_str = ", ".join(x for x in [loc.get("name") or loc.get("city"),
                                            loc.get("province")] if x).strip(", ")
            url = p.get("url") or p.get("path") or ""
            slug = url.rstrip("/").rsplit("/", 1)[-1] or str(p.get("id"))
            out.append(dict(firm=firm, id=f"pinpoint-{slug}",
                            title=(p.get("title") or "").strip(),
                            location=loc_str, url=url, source="pinpoint",
                            posted_date=None))
    except Exception as e:
        print(f"  ! pinpoint {firm}: {e}", file=sys.stderr)
    return out


def fetch_oracle(firm, host, site_number, site_name):
    """Oracle Fusion Recruiting (Candidate Experience) — e.g. Lazard. The public
    REST endpoint recruitingCEJobRequisitions returns clean JSON: reqs live under
    items[0].requisitionList with Title / PrimaryLocation / PostedDate / Id, and
    items[0].TotalJobsCount gives the count. Paged by limit/offset. Public URL is
    /hcmUI/CandidateExperience/en/sites/<siteName>/job/<Id>."""
    api = (f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions")
    LIMIT = 200
    out, offset, total = [], 0, None
    try:
        while offset < 5000:  # hard ceiling
            finder = (f"findReqs;siteNumber={site_number},limit={LIMIT},"
                      f"offset={offset},sortBy=POSTING_DATES_DESC")
            params = {"onlyData": "true",
                      "expand": "requisitionList.secondaryLocations,flexFieldsFacet.values",
                      "finder": finder}
            r = requests.get(api, headers={**UA, "Accept": "application/json"},
                             params=params, timeout=TIMEOUT)
            r.raise_for_status()
            block = (r.json().get("items") or [{}])[0]
            if total is None:
                total = block.get("TotalJobsCount", 0)
            reqs = block.get("requisitionList") or []
            if not reqs:
                break
            for q in reqs:
                rid = q.get("Id")
                out.append(dict(firm=firm, id=f"oracle-{host}-{rid}",
                                title=(q.get("Title") or "").strip(),
                                location=(q.get("PrimaryLocation") or "").strip(),
                                url=(f"https://{host}/hcmUI/CandidateExperience/en/"
                                     f"sites/{site_name}/job/{rid}"),
                                source="oracle",
                                posted_date=_posted(q.get("PostedDate"))))
            offset += LIMIT
            if total and offset >= total:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! oracle {firm}: {e}", file=sys.stderr)
    return out


def fetch_hrmdirect(firm, host):
    """HRM Direct / ClearCompany boards (e.g. Oppenheimer). The list view carries
    no structured location, but ?city=<name> returns only that city's jobs — so we
    query each target city and tag the row with it. Server-rendered HTML (latin-1),
    no bot gate; list has no post date, so posted_date is left null (row kept)."""
    import html as _html
    base = f"https://{host}/employment/job-openings.php"
    item_re = re.compile(r'jobListTitle[^>]*>\s*<a\s+href="([^"]*req=(\d+)[^"]*)"[^>]*>'
                         r'(.*?)</a>', re.S)
    out, seen = [], set()
    # cities map onto the METROS keys the downstream filter understands
    for city in ("New York", "Jersey City", "Chicago", "San Francisco"):
        try:
            r = requests.get(base, headers=UA,
                             params={"search": "true", "city": city}, timeout=TIMEOUT)
            r.encoding = "latin-1"
            for href, req, title in item_re.findall(r.text):
                if req in seen:
                    continue
                seen.add(req)
                title = _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title))).strip()
                out.append(dict(firm=firm, id=f"hrm-{req}", title=title,
                                location=city,
                                url=f"https://{host}/employment/job-opening.php?req={req}",
                                source="hrmdirect", posted_date=None))
        except Exception as e:
            print(f"  ! hrmdirect {firm} ({city}): {e}", file=sys.stderr)
    return out


_PAGEUP_CARD = re.compile(
    r'article__header__text__title[^>]*>\s*<a[^>]*href="([^"]*JobDetail\?jobId=(\d+))"'
    r'[^>]*>(.*?)</a>(.*?)(?=article__header__text__title|$)', re.S)
_PAGEUP_LOC = re.compile(r'icon-location\.svg[\s\S]*?<p>\s*(.*?)\s*</p>', re.S)
_PAGEUP_DATE = re.compile(r'(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})')


def fetch_pageup(firm, host, locale="en_US"):
    """PageUp People boards (e.g. Macquarie). SearchJobs is server-rendered HTML,
    fixed at 9 cards/page and paged by jobOffset; free-text search is ignored, so
    we page the whole board and let the metro/title filters cut it down. Each card
    yields title, jobId, office location, and a 'DD Mon YYYY' date."""
    import html as _html
    base = f"https://{host}/{locale}/careers/SearchJobs/"
    out, offset, total = [], 0, None
    try:
        while offset < 3000:  # hard ceiling (~330 pages)
            r = requests.get(base, headers={**UA, "X-Requested-With": "XMLHttpRequest"},
                             params={"jobRecordsPerPage": 9, "jobOffset": offset},
                             timeout=TIMEOUT)
            r.raise_for_status()
            html_txt = r.text
            if total is None:
                m = re.search(r'([\d,]+)\s+results', html_txt)
                total = int(m.group(1).replace(",", "")) if m else 0
            cards = _PAGEUP_CARD.findall(html_txt)
            if not cards:
                break
            for href, jid, title, tail in cards:
                lm = _PAGEUP_LOC.search(tail)
                loc = _html.unescape(re.sub(r"<[^>]+>", "", lm.group(1))).strip() if lm else ""
                dm = _PAGEUP_DATE.search(tail)
                posted = None
                if dm:
                    try:
                        posted = datetime.strptime(dm.group(1), "%d %b %Y").strftime("%Y-%m-%d")
                    except Exception:
                        posted = None
                title = _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title))).strip()
                out.append(dict(firm=firm, id=f"pageup-{host}-{jid}", title=title,
                                location=loc,
                                url=f"https://{host}/{locale}/careers/JobDetail?jobId={jid}",
                                source="pageup", posted_date=posted))
            offset += 9
            if total and offset >= total:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! pageup {firm}: {e}", file=sys.stderr)
    return out


_ICIMS_ITEM = re.compile(r'iCIMS_JobCardItem(.*?)(?=iCIMS_JobCardItem|</ul>)', re.S)
_ICIMS_LOC = re.compile(r'Location</span>\s*<span[^>]*>\s*(.*?)\s*</span>', re.S)
_ICIMS_ANCHOR = re.compile(r'href="([^"]*/jobs/(\d+)/[^"]*)"[^>]*class="iCIMS_Anchor"', re.S)
_ICIMS_TITLE = re.compile(r'<h3[^>]*>\s*(.*?)\s*</h3>', re.S)


def fetch_icims(firm, host):
    """iCIMS career portals (e.g. Stifel, which also carries KBW). The in-iframe
    search page is server-rendered HTML: each `iCIMS_JobCardItem` holds a Location
    label + value, and an anchor (`iCIMS_Anchor`) whose <h3> is the title. Paged by
    `pr` (0-indexed, 50/page). No post date in the list, so posted_date is null."""
    import html as _html
    base = f"https://{host}/jobs/search"
    out, page, seen = [], 0, set()
    try:
        while page < 40:  # hard ceiling (2000 reqs)
            r = requests.get(base, headers=UA,
                             params={"pr": page, "in_iframe": 1}, timeout=TIMEOUT)
            r.raise_for_status()
            items = _ICIMS_ITEM.findall(r.text)
            if not items:
                break
            added = 0
            for chunk in items:
                a = _ICIMS_ANCHOR.search(chunk)
                t = _ICIMS_TITLE.search(chunk)
                if not (a and t):
                    continue
                jid = a.group(2)
                if jid in seen:
                    continue
                seen.add(jid); added += 1
                lm = _ICIMS_LOC.search(chunk)
                loc = _html.unescape(re.sub(r"<[^>]+>", "", lm.group(1))).strip() if lm else ""
                title = _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t.group(1)))).strip()
                url = _html.unescape(a.group(1)).split("?")[0]
                out.append(dict(firm=firm, id=f"icims-{host}-{jid}", title=title,
                                location=loc, url=url, source="icims",
                                posted_date=None))
            if added == 0:
                break
            page += 1
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! icims {firm}: {e}", file=sys.stderr)
    return out


def fetch_workday_site(firm, dc, tenant, site):
    """Workday tenants served on the shared myworkdaysite.com host (e.g. Perella
    Weinberg). Identical CXS protocol to fetch_workday, but the URL shape is
    https://<dc>.myworkdaysite.com/{wday/cxs|recruiting}/<tenant>/<site>."""
    host = f"https://{dc}.myworkdaysite.com"
    base = f"{host}/wday/cxs/{tenant}/{site}/jobs"
    LIMIT = 20
    out, offset, total = [], 0, None
    try:
        while True:
            body = {"appliedFacets": {}, "limit": LIMIT, "offset": offset, "searchText": ""}
            r = requests.post(base, headers={**UA, "Content-Type": "application/json"},
                              json=body, timeout=TIMEOUT); r.raise_for_status()
            data = r.json()
            posts = data.get("jobPostings", [])
            if total is None:
                total = data.get("total", 0)
            if not posts:
                break
            for p in posts:
                path = p.get("externalPath", "")
                out.append(dict(firm=firm, id=f"wds-{tenant}-{site}-{path}",
                                title=(p.get("title") or "").strip(),
                                location=(p.get("locationsText") or "").strip(),
                                url=f"{host}/recruiting/{tenant}/{site}{path}",
                                source="workday",
                                posted_date=_workday_posted(p.get("postedOn"))))
            offset += LIMIT
            if offset >= total or len(posts) < LIMIT:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! workday-site {firm}: {e}", file=sys.stderr)
    return out


def fetch_workday(firm, tenant, dc, site):
    base = f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    host = f"https://{tenant}.{dc}.myworkdayjobs.com"
    LIMIT = 20
    out, offset, total = [], 0, None
    try:
        while True:
            body = {"appliedFacets": {}, "limit": LIMIT, "offset": offset, "searchText": ""}
            r = requests.post(base, headers={**UA, "Content-Type": "application/json"},
                              json=body, timeout=TIMEOUT); r.raise_for_status()
            data = r.json()
            posts = data.get("jobPostings", [])
            # Workday only reports the real `total` on the first page; later pages
            # return total=0. Capture it once and page against that fixed value.
            if total is None:
                total = data.get("total", 0)
            if not posts:
                break
            for p in posts:
                path = p.get("externalPath", "")
                out.append(dict(firm=firm,
                                id=f"wd-{tenant}-{site}-{path}",
                                title=(p.get("title") or "").strip(),
                                location=(p.get("locationsText") or "").strip(),
                                # public URL needs the site segment; host+path alone 404s
                                url=f"{host}/{site}{path}", source="workday",
                                # Workday exposes only a relative `postedOn` label on
                                # tenants configured for it; parse it to an approx date
                                # (None when the tenant omits it — row kept as before).
                                posted_date=_workday_posted(p.get("postedOn"))))
            offset += LIMIT
            # Stop when we've reached the first-page total, or the page came back
            # short (last page) — a belt-and-suspenders guard if `total` is wrong.
            if offset >= total or len(posts) < LIMIT:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! workday {firm}: {e}", file=sys.stderr)
    return out


# ---------------------------------------------------------------- Goldman Sachs (higher.gs)
# SCAFFOLD — Goldman runs its careers site (higher.gs.com) as a Next.js + Apollo
# app. Reverse-engineered 2026-09-15:
#   • The results page issues a GraphQL POST to https://higher.gs.com/graphql
#     with operationName "GetRoles" (confirmed: Apollo httpLink `uri: '/graphql'`,
#     op names "GetRoles"/"Opportunities" in the bundle). Pagination is by page.
#   • Each role's data (confirmed shape, type ExtendedRoleGraphQlDTO) has:
#       roleId (e.g. "184219_GS_MID_CAREER"), jobTitle, corporateTitle
#       ("Analyst"/"Associate"/…), locations[{city,state,country,primary}],
#       division, status ("POSTED"), applyActive.
#   • Public role URL is https://higher.gs.com/roles/<numeric-id> (numeric prefix
#     of roleId). robots.txt allows only /roles/.
#
# NOTE: during scaffolding the live /graphql endpoint returned 404 from outside
# GS's network (their own site's call 404'd too), so the exact GetRoles query
# text + variable names could NOT be confirmed. The query below is a best-effort
# reconstruction. Verify/adjust `GS_GETROLES_QUERY` and `variables` once the
# endpoint responds 200 (open higher.gs.com → DevTools → Network → the POST to
# /graphql → copy its request payload). Until then this fetcher fails gracefully
# (logs and returns []), exactly like the other unconfirmed registries.
GS_GRAPHQL = "https://higher.gs.com/graphql"
GS_ROLE_URL = "https://higher.gs.com/roles/{numeric_id}"
GS_GETROLES_QUERY = """
query GetRoles($searchText: String, $page: Int, $pageSize: Int) {
  roles(searchText: $searchText, page: $page, pageSize: $pageSize) {
    total
    items {
      roleId
      jobTitle
      corporateTitle
      status
      locations { city state country primary }
    }
  }
}
""".strip()


def fetch_goldman(firm="Goldman Sachs", search_text="", page_size=50, max_pages=20):
    """Scaffold fetcher for Goldman Sachs (higher.gs.com GraphQL). Returns rows in
    the same shape as the other fetchers, or [] on any error (graceful)."""
    headers = {**UA, "Content-Type": "application/json",
               "Accept": "application/json",
               # Apollo clients usually send these; harmless if ignored:
               "apollographql-client-name": "higher"}
    out, page = [], 1
    try:
        while page <= max_pages:
            body = {"operationName": "GetRoles", "query": GS_GETROLES_QUERY,
                    "variables": {"searchText": search_text, "page": page,
                                  "pageSize": page_size}}
            r = requests.post(GS_GRAPHQL, headers=headers, json=body, timeout=TIMEOUT)
            r.raise_for_status()
            payload = r.json()
            if payload.get("errors"):
                print(f"  ! goldman GraphQL errors: {str(payload['errors'])[:160]}",
                      file=sys.stderr)
                break
            roles = (((payload.get("data") or {}).get("roles") or {}).get("items")) or []
            if not roles:
                break
            for role in roles:
                rid = str(role.get("roleId") or "")
                numeric = rid.split("_")[0]
                loc = role.get("locations") or []
                primary = next((l for l in loc if l.get("primary")), (loc[0] if loc else {}))
                loc_str = ", ".join(x for x in [primary.get("city"), primary.get("state"),
                                                primary.get("country")] if x)
                # corporateTitle carries the seniority ("Analyst"/"Associate"); fold it
                # into the title text so the level filter catches junior roles.
                title = (role.get("jobTitle") or "").strip()
                corp = (role.get("corporateTitle") or "").strip()
                out.append(dict(firm=firm, id=f"gs-{rid}",
                                title=f"{title} ({corp})" if corp else title,
                                location=loc_str,
                                url=GS_ROLE_URL.format(numeric_id=numeric),
                                source="goldman", posted_date=None))
            page += 1
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! goldman {firm}: {e}", file=sys.stderr)
    return out


# ---------------------------------------------------------------- Citadel Securities
# Citadel Securities runs a WordPress careers site behind Cloudflare. The listing
# loads via admin-ajax (action=careers_listing_filter) and returns JSON whose
# `content` is an HTML fragment of cards. Plain requests get a Cloudflare "Just a
# moment" 403, so this fetcher uses `cloudscraper` (pip install cloudscraper) to
# solve the JS challenge. If cloudscraper isn't installed or the challenge can't
# be solved, it logs and returns [] (graceful) — nothing else breaks.
CS_AJAX = "https://www.citadelsecurities.com/wp-admin/admin-ajax.php"
CS_SECTIONS = "323,325,324,326"   # WP taxonomy IDs for the job categories (all)
# The fragment renders each card as an <a ...> whose attributes are split across
# lines, so match the whole card anchor first, then pull fields out of it.
CS_CARD_RE = re.compile(r'<a\b([^>]*?careers-listing-card[^>]*?)>(.*?)</a>', re.S)
CS_HREF_RE = re.compile(r'href="([^"]+)"')
CS_POS_RE = re.compile(r'data-position="([^"]*)"')
CS_LOC_RE = re.compile(r'careers-listing-card__location">\s*(.*?)\s*</div>', re.S)


def fetch_citadel(firm="Citadel Securities"):
    try:
        import cloudscraper
    except Exception:
        print("  ! citadel: cloudscraper not installed (pip install cloudscraper) — skipping",
              file=sys.stderr)
        return []
    import html as _html
    out = []
    try:
        s = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True})
        body = {"action": "careers_listing_filter", "selected-job-sections": CS_SECTIONS,
                "current_page": "1", "per_page": "500", "sort_order": "DESC"}
        headers = {"X-Requested-With": "XMLHttpRequest",
                   "Referer": "https://www.citadelsecurities.com/careers/open-opportunities/"}
        r = s.post(CS_AJAX, headers=headers, data=body, timeout=45)
        r.raise_for_status()
        data = r.json()
        content = data.get("content", "") or ""
        for attrs, inner in CS_CARD_RE.findall(content):
            href = CS_HREF_RE.search(attrs)
            pos = CS_POS_RE.search(attrs)
            loc = CS_LOC_RE.search(inner)
            if not (href and pos):
                continue
            url = href.group(1).strip()
            title = _html.unescape(pos.group(1)).strip()
            loc_str = _html.unescape(re.sub(r"\s+", " ", loc.group(1))).strip() if loc else ""
            slug = url.rstrip("/").rsplit("/", 1)[-1]
            out.append(dict(firm=firm, id=f"cs-{slug}", title=title, location=loc_str,
                            url=url, source="citadel", posted_date=None))
    except Exception as e:
        print(f"  ! citadel {firm}: {e}", file=sys.stderr)
    return out


# ---------------------------------------------------------------- Radancy/TMP
# Several banks run the Radancy ("TalentBrew") careers platform: the endpoint
# {host}/search-jobs/results returns JSON whose `results` is an HTML card
# fragment. The free-text Location param isn't honored, so we narrow by metro
# *keyword* and let the normal metro/title filters do the real work. Card themes
# differ between tenants (Citi uses sr-job-item, Barclays uses job-title--link),
# but all share a /job/ href, a data-job-id, and a "job-location" element — so
# one generic parser handles them. Plain requests work (no bot gate).
WORKDAY_SITE = {  # firm -> (dc, tenant, site)  Workday on the myworkdaysite.com host
    # Same CXS protocol as WORKDAY, but the URL shape is
    # https://<dc>.myworkdaysite.com/{wday/cxs|recruiting}/<tenant>/<site>.
    "Perella Weinberg Partners": ("wd1", "pwp", "PWP_Experienced_Opportunities"),
}
RADANCY = {              # firm -> host
    "Citi":       "jobs.citi.com",
    "Barclays":   "search.jobs.barclays",
    "ING":        "careers.ing.com",
    "BlackRock":  "careers.blackrock.com",   # yellow-tier; ~151 NY hits
    # Citizens' careers site looked Phenom at first glance but is actually Radancy
    # (/search-jobs/ + SetSearchRequestGeoLocation) — same platform as Citi et al.
    "Citizens Financial Group": "jobs.citizensbank.com",
}
PHENOM = {               # firm -> (host, country, lang)  Phenom People careers
    # Phenom serves job search from POST https://<host>/widgets with
    # ddoKey="refineSearch". No cookie/CSRF/tenant handshake is needed when the
    # POST goes to the firm's own careers host (tenant is keyed off Host); the
    # docs' "Tenant not identified" only happens on the generic /api/apps/* paths.
    # Response: {refineSearch:{totalHits, data:{jobs:[…]}}}; each job carries a
    # real ISO postedDate, so the 30-day filter applies. RBC/PNC/Truist/Regions
    # all front Workday underneath, so applyUrl is a myworkdayjobs deep link.
    "RBC Capital Markets":     ("jobs.rbc.com",       "ca", "en_ca"),
    "PNC Financial Services":  ("careers.pnc.com",    "us", "en_us"),
    "Truist Securities":       ("careers.truist.com", "us", "en_us"),
    "Regions Securities":      ("careers.regions.com","us", "en_us"),
    # FT's old Workday board (wd5/Primary-External-1) is dead (total=0); its live
    # listings are on Phenom at careers.franklintempleton.com (201 reqs).
    "Franklin Templeton":      ("careers.franklintempleton.com", "us", "en_us"),
}
RADANCY_METRO_KW = ["new york", "jersey city", "chicago", "san francisco", "bay area"]
# Radancy ships two card themes: a classic one (BlackRock/Barclays/ING) where the
# location + date <span>s sit INSIDE the /job/ anchor, and Citi's sr-job-item theme
# where they sit AFTER it. Splitting on the anchor and reading each card's window
# (anchor start -> next anchor start) handles both — and, crucially, keeps the
# location/date out of the title (the old single cross-card regex folded them into
# the classic-theme title and read the *next* card's location).
RADANCY_ANCHOR_RE = re.compile(r'<a\b([^>]*?/job/[^>]*?)>(.*?)</a>', re.S)
RADANCY_HREF_RE = re.compile(r'href="([^"]+)"')
RADANCY_JID_RE = re.compile(r'data-job-id="(\d+)"')
# "sr-job-location" contains the substring "job-location", so this one class regex
# matches both themes.
RADANCY_LOC_RE = re.compile(r'class="[^"]*job-location[^"]*"[^>]*>\s*(.*?)\s*</', re.S)
# Only the classic theme exposes a posted date, as MM/DD/YYYY. Absent -> null.
RADANCY_DATE_RE = re.compile(r'job-date-posted[^"]*"[^>]*>\s*(\d{1,2}/\d{1,2}/\d{4})')
RADANCY_SPAN_STRIP = re.compile(
    r'<span\b[^>]*class="[^"]*(?:job-location|job-date-posted)[^"]*"[^>]*>.*?</span>', re.S)
_TAG_RE = re.compile(r"<[^>]+>")


def fetch_radancy(firm, host, source):
    import html as _html
    base = f"https://{host}/search-jobs/results"
    out, seen = [], set()
    try:
        for kw in RADANCY_METRO_KW:
            page = 1
            while page <= 15:
                params = {"ActiveFacetID": 0, "CurrentPage": page, "RecordsPerPage": 100,
                          "Keywords": kw, "SortCriteria": 0, "SearchType": 5,
                          "SearchResultsModuleName": "Search Results"}
                r = requests.get(base, headers={**UA, "X-Requested-With": "XMLHttpRequest"},
                                 params=params, timeout=TIMEOUT)
                r.raise_for_status()
                frag = (r.json() or {}).get("results", "") or ""
                anchors = list(RADANCY_ANCHOR_RE.finditer(frag))
                if not anchors:
                    break
                for i, a in enumerate(anchors):
                    attrs, inner = a.group(1), a.group(2)
                    hm = RADANCY_HREF_RE.search(attrs)
                    if not hm:
                        continue
                    href = hm.group(1).strip()
                    jm = RADANCY_JID_RE.search(attrs)
                    jid = jm.group(1) if jm else href.rstrip("/").rsplit("/", 1)[-1]
                    if jid in seen:
                        continue
                    seen.add(jid)
                    # card window ends at the next /job/ anchor (or a bounded tail)
                    end = anchors[i + 1].start() if i + 1 < len(anchors) else a.end() + 800
                    window = frag[a.start():end]
                    # title = anchor inner minus any nested location/date spans
                    title_src = RADANCY_SPAN_STRIP.sub("", inner)
                    title = _html.unescape(re.sub(r"\s+", " ", _TAG_RE.sub("", title_src))).strip()
                    lm = RADANCY_LOC_RE.search(window)
                    loc_str = (_html.unescape(re.sub(r"\s+", " ", _TAG_RE.sub("", lm.group(1)))).strip()
                               if lm else "")
                    dm = RADANCY_DATE_RE.search(window)
                    posted = None
                    if dm:
                        try:
                            posted = datetime.strptime(dm.group(1), "%m/%d/%Y").strftime("%Y-%m-%d")
                        except Exception:
                            posted = None
                    url = href if href.startswith("http") else f"https://{host}{href}"
                    out.append(dict(firm=firm, id=f"{source}-{jid}", title=title,
                                    location=loc_str, url=url, source=source,
                                    posted_date=posted))
                if len(anchors) < 100:
                    break
                page += 1
                time.sleep(0.25)
    except Exception as e:
        print(f"  ! {source} {firm}: {e}", file=sys.stderr)
    return out


def fetch_phenom(firm, host, country="us", lang="en_us"):
    """Phenom People careers boards (e.g. RBC, PNC, Truist, Regions). Job search
    is a POST to https://<host>/widgets with ddoKey="refineSearch"; the response
    nests the page under refineSearch.data.jobs with refineSearch.totalHits for
    pagination. Phenom's keyword field doesn't reliably narrow by location, so we
    page the whole board and let the metro/title filters cut it down. Each job has
    cityStateCountry, an ISO postedDate, and an applyUrl (a Workday deep link for
    these tenants); we drop a trailing '/apply' so the link lands on the JD."""
    base = f"https://{host}/widgets"
    lang_short = lang.split("_")[0]
    out, offset, total, SIZE = [], 0, None, 100
    try:
        while offset < 6000:  # hard ceiling
            body = {"lang": lang, "deviceType": "desktop", "country": country,
                    "ddoKey": "refineSearch", "sortBy": "", "subsearch": "",
                    "from": offset, "jobs": True, "counts": True,
                    "all_fields": ["category", "state", "city", "type", "country",
                                   "subCategory", "seqNo"],
                    "pageName": "search-results", "size": SIZE, "clearAll": False,
                    "jdsource": "facets", "isSliderEnable": False,
                    "isMultiLingual": False, "pageId": "", "siteType": "external",
                    "keywords": "", "global": True, "selected_fields": {},
                    "locationData": {}, "sort": {}, "esreqid": ""}
            r = requests.post(base, headers={**UA, "Content-Type": "application/json"},
                              json=body, timeout=TIMEOUT)
            r.raise_for_status()
            rs = (r.json() or {}).get("refineSearch") or {}
            if total is None:
                total = rs.get("totalHits") or 0
            jobs = (rs.get("data") or {}).get("jobs") or []
            if not jobs:
                break
            for j in jobs:
                seq = j.get("jobSeqNo") or j.get("jobId") or j.get("reqId")
                loc = (j.get("cityStateCountry") or j.get("cityState")
                       or ", ".join(x for x in [j.get("city"), j.get("state"),
                                                j.get("country")] if x)).strip()
                url = (j.get("applyUrl") or "").strip()
                if url.endswith("/apply"):
                    url = url[:-6]
                if not url:
                    url = f"https://{host}/{country}/{lang_short}/job/{seq}"
                out.append(dict(firm=firm, id=f"phenom-{host}-{seq}",
                                title=(j.get("title") or "").strip(),
                                location=loc, url=url, source="phenom",
                                posted_date=_posted(j.get("postedDate")
                                                    or j.get("dateCreated"))))
            offset += SIZE
            if total and offset >= total:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! phenom {firm}: {e}", file=sys.stderr)
    return out


# ---------------------------------------------------------------- filter/dedupe
def metro_of(loc):
    l = loc.lower()
    for m, needles in METROS.items():
        if any(n in l for n in needles):
            return m
    if _NY_STATE_RE.search(loc):
        return "NY + Jersey City"
    return None


def title_ok(firm, title):
    t = title.lower()
    if any(x in t for x in EXCLUDE):
        return False
    kws = TITLES_TRADING if firm in TRADING_FIRMS else TITLES
    return any(k in t for k in kws)


MAX_AGE_DAYS = 30


def age_ok(posted_date):
    """Drop listings we KNOW are older than MAX_AGE_DAYS. Rows with no post date
    (Workday/Citi/Citadel/Radancy) can't be aged, so they're kept — we only
    exclude ones proven stale (from Greenhouse `first_published` / Ashby
    `publishedAt`)."""
    if not posted_date:
        return True
    try:
        d = datetime.strptime(posted_date[:10], "%Y-%m-%d").date()
    except Exception:
        return True
    return (datetime.now(timezone.utc).date() - d).days <= MAX_AGE_DAYS


def collect():
    raw = []
    print("Greenhouse…")
    for f, tok in GREENHOUSE.items():
        rows = fetch_greenhouse(f, tok); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Ashby…")
    for f, nm in ASHBY.items():
        rows = fetch_ashby(f, nm); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Jibe/iCIMS…")
    for f, host in JIBE.items():
        rows = fetch_jibe(f, host); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Pinpoint…")
    for f, host in PINPOINT.items():
        rows = fetch_pinpoint(f, host); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Oracle Recruiting…")
    for f, (host, num, name) in ORACLE.items():
        rows = fetch_oracle(f, host, num, name); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("HRM Direct…")
    for f, host in HRMDIRECT.items():
        rows = fetch_hrmdirect(f, host); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("PageUp…")
    for f, (host, locale) in PAGEUP.items():
        rows = fetch_pageup(f, host, locale); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("iCIMS…")
    for f, host in ICIMS.items():
        rows = fetch_icims(f, host); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Workday…")
    for f, (t, dc, s) in WORKDAY.items():
        rows = fetch_workday(f, t, dc, s); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Workday (myworkdaysite)…")
    for f, (dc, t, s) in WORKDAY_SITE.items():
        rows = fetch_workday_site(f, dc, t, s); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Goldman Sachs (higher.gs)…")
    rows = fetch_goldman("Goldman Sachs"); print(f"  {'Goldman Sachs':<24}{len(rows):>4}"); raw += rows
    print("Citadel Securities (cloudscraper)…")
    rows = fetch_citadel("Citadel Securities"); print(f"  {'Citadel Securities':<24}{len(rows):>4}"); raw += rows
    print("Radancy…")
    for f, host in RADANCY.items():
        rows = fetch_radancy(f, host, f.lower().split()[0]); print(f"  {f:<24}{len(rows):>4}"); raw += rows
    print("Phenom People…")
    for f, (host, country, lang) in PHENOM.items():
        rows = fetch_phenom(f, host, country, lang); print(f"  {f:<24}{len(rows):>4}"); raw += rows

    kept, seen = [], set()
    for r in raw:
        m = metro_of(r["location"])
        if (m and title_ok(r["firm"], r["title"]) and age_ok(r.get("posted_date"))
                and r["id"] not in seen):
            seen.add(r["id"]); r["metro"] = m; kept.append(r)
    return kept


# ---------------------------------------------------------------- supabase
def push_supabase(rows):
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("Supabase env not set — skipping DB upsert."); return
    endpoint = f"{url}/rest/v1/jobs?on_conflict=id"
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    # Stamp every row from THIS run with one shared timestamp. The upsert writes
    # updated_at on both inserts and merge-duplicates, so after the push every
    # currently-live listing carries `run_ts` while anything left over from an
    # earlier run keeps its older timestamp — that's how the reconcile below
    # spots the roles a firm has since delisted.
    run_ts = datetime.now(timezone.utc).isoformat()
    # upsert in chunks — a network/HTTP failure here must not crash the run
    # (the JSON/CSV are already written; a daily cron should exit cleanly).
    for i in range(0, len(rows), 200):
        chunk = [{**r, "updated_at": run_ts} for r in rows[i:i+200]]
        try:
            r = requests.post(endpoint, headers=headers, data=json.dumps(chunk), timeout=TIMEOUT)
        except Exception as e:
            print(f"  ! supabase request failed: {e}", file=sys.stderr); continue
        if r.status_code >= 300:
            print(f"  ! supabase {r.status_code}: {r.text[:200]}", file=sys.stderr)
        else:
            print(f"  upserted {len(chunk)} rows")

    # Reconcile: drop listings that have vanished from a firm's source since we
    # last saw them (delisted / filled). A row is stale if its firm appeared in
    # THIS run but the row itself wasn't refreshed (updated_at < run_ts). We only
    # prune firms that returned at least one row this run, so a transient fetch
    # failure — which yields zero rows for that firm — can never wipe its whole
    # board. This is what finally ages out undated Workday/Radancy/iCIMS/etc.
    # rows: their posted_date is null, so the DATED purge below can never reach
    # them, and before this a delisted Workday role lingered on the dashboard
    # indefinitely.
    for firm in sorted({r["firm"] for r in rows}):
        try:
            d = requests.delete(f"{url}/rest/v1/jobs",
                                headers={**headers, "Prefer": "return=minimal"},
                                params={"firm": f"eq.{firm}", "updated_at": f"lt.{run_ts}"},
                                timeout=TIMEOUT)
            if d.status_code >= 300:
                print(f"  ! supabase reconcile {firm} {d.status_code}: {d.text[:150]}",
                      file=sys.stderr)
        except Exception as e:
            print(f"  ! supabase reconcile {firm} failed: {e}", file=sys.stderr)

    # Purge stale DATED listings so the DB honors the <=MAX_AGE_DAYS rule. Only
    # rows with a posted_date older than the cutoff are removed — undated rows
    # (Workday/Citi/Citadel/Radancy) have null posted_date, which never matches
    # `lt`, so they're left untouched. Filtered delete, never a blanket wipe.
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=MAX_AGE_DAYS)).isoformat()
    try:
        d = requests.delete(f"{url}/rest/v1/jobs?posted_date=lt.{cutoff}",
                            headers={**headers, "Prefer": "return=minimal"}, timeout=TIMEOUT)
        if d.status_code < 300:
            print(f"  purged listings posted before {cutoff}")
        else:
            print(f"  ! supabase purge {d.status_code}: {d.text[:150]}", file=sys.stderr)
    except Exception as e:
        print(f"  ! supabase purge failed: {e}", file=sys.stderr)


# ---------------------------------------------------------------- newsletter
def _newsletter_html(new_jobs, total, today, dash_url):
    """Build an inbox-friendly HTML digest of today's NEW roles, styled to match
    the dashboard's editorial theme (soft pink + cream + forest green, Fraunces
    serif with italic-rose accents, IBM Plex Mono eyebrows/labels).

    Grouped by metro, capped so a big day doesn't produce a wall of text — the
    email is a teaser whose job is to make the reader click through. All styling
    is inline so Gmail/Outlook render it without stripping; the Fraunces/Plex
    web fonts load via <link> where supported and fall back to Georgia serif /
    system monospace everywhere else. Light-only: email dark-mode is unreliable,
    so we ship the dashboard's light palette."""
    # dashboard palette (light)
    BG, PANEL, BG2 = "#f7d7e0", "#fdf7ee", "#f3ecdb"
    INK, SOFT, LINE, LINE2 = "#2a1620", "#9c7683", "#e9c3d1", "#ecd9c9"
    GREEN, ON_GREEN, ROSE, LIP = "#17392a", "#fdf3e2", "#cf5f89", "#c0392b"
    SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
    MONO = "'IBM Plex Mono', ui-monospace, 'Courier New', monospace"
    SANS = "'IBM Plex Sans', -apple-system, Segoe UI, Arial, sans-serif"

    CAP = 40  # most rows we list inline; the rest roll up into a "+N more" line
    shown = new_jobs[:CAP]
    rows = []
    cur = None
    for j in shown:
        if j["metro"] != cur:
            cur = j["metro"]
            rows.append(
                f'<tr><td style="padding:20px 0 7px;font-family:{MONO};font-size:11px;'
                f'letter-spacing:.16em;text-transform:uppercase;color:{ROSE}">'
                f'✿ {_esc(cur)}</td></tr>')
        title = _esc(j["title"])
        firm = _esc(j["firm"])
        loc = _esc(j.get("location") or "")
        rows.append(
            f'<tr><td style="padding:9px 0;border-bottom:1px solid {LINE2}">'
            f'<div style="font-family:{MONO};font-size:9.5px;letter-spacing:.08em;'
            f'text-transform:uppercase;color:{ROSE};padding-bottom:3px">{firm}</div>'
            f'<a href="{_esc(j["url"])}" style="font-family:{SERIF};font-weight:600;'
            f'font-size:16px;line-height:1.25;color:{INK};text-decoration:none">{title}</a>'
            f'<div style="font-family:{SANS};font-size:12.5px;color:{SOFT};padding-top:2px">{loc}</div>'
            f'</td></tr>')
    more = len(new_jobs) - len(shown)
    if more > 0:
        rows.append(
            f'<tr><td style="padding:14px 0 2px;font-family:{SERIF};font-style:italic;'
            f'font-size:15px;color:{SOFT}">…and {more} more new role{"s" if more != 1 else ""} '
            f'waiting on the board.</td></tr>')

    n = len(new_jobs)
    if n:
        intro = f"{n} fresh opening{'s' if n != 1 else ''} landed since yesterday — a quick look below."
        cta = "Open the dashboard →"
    else:
        intro = "No new roles overnight, but the board is still warm — worth a peek."
        cta = "Browse the board →"
    fonts = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;"
             "1,9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap")
    return f"""\
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<link rel="stylesheet" href="{fonts}">
</head><body style="margin:0;background:{BG};padding:26px 12px;font-family:{SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:{PANEL};border-radius:18px;overflow:hidden;border:1px solid {LINE};box-shadow:0 8px 24px rgba(42,22,32,.10)">

<tr><td style="padding:32px 34px 8px;background:linear-gradient(135deg,#f8dde8 0%,{PANEL} 60%)">
  <div style="font-family:{MONO};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:{ROSE};padding-bottom:8px">✿ Morning Digest</div>
  <div style="font-family:{SERIF};font-weight:600;font-size:38px;line-height:1.05;color:{INK};letter-spacing:-.01em">Street <em style="font-style:italic;color:{ROSE}">Watch</em></div>
  <div style="font-family:{SANS};font-size:14px;color:{SOFT};padding-top:8px">{today}</div>
</td></tr>

<tr><td style="padding:18px 34px 0;font-family:{SERIF};font-style:italic;font-size:19px;color:{INK}">
  Good morning, Ms Tian ✿
</td></tr>

<tr><td style="padding:12px 34px 2px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="background:{BG2};border:1px solid {LIP};border-radius:14px;padding:10px 18px;text-align:center">
      <div style="font-family:{SERIF};font-size:26px;line-height:1;color:{LIP}">{n}</div>
      <div style="font-family:{MONO};font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:{SOFT};padding-top:4px">New today</div>
    </td>
    <td style="width:10px"></td>
    <td style="background:{BG2};border:1px solid {LINE2};border-radius:14px;padding:10px 18px;text-align:center">
      <div style="font-family:{SERIF};font-size:26px;line-height:1;color:{GREEN}">{total}</div>
      <div style="font-family:{MONO};font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:{SOFT};padding-top:4px">Live on board</div>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:14px 34px 4px;font-family:{SERIF};font-style:italic;font-size:17px;color:{INK}">
  {intro}
</td></tr>

<tr><td style="padding:2px 34px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{''.join(rows)}</table></td></tr>

<tr><td style="padding:18px 34px 34px" align="center">
  <a href="{_esc(dash_url)}" style="display:inline-block;background:{GREEN};color:{ON_GREEN};font-family:{SANS};font-weight:600;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:999px">{cta}</a>
</td></tr>
</table>
<div style="font-family:{MONO};font-size:10.5px;letter-spacing:.06em;color:{SOFT};padding:18px 0 0">STREET WATCH · sent automatically after the daily job pull</div>
</td></tr></table></body></html>"""


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _newsletter_text(new_jobs, total, today, dash_url):
    """Plain-text alternative part — what non-HTML clients (and spam filters)
    read. Keeps the digest legible without any markup."""
    lines = [f"Street Watch — {today} morning digest", "", "Good morning, Ms Tian", ""]
    n = len(new_jobs)
    if n:
        lines.append(f"{n} new role{'s' if n != 1 else ''} since yesterday ({total} live on the board).")
    else:
        lines.append(f"No new roles overnight — {total} still live on the board.")
    lines.append("")
    cur = None
    for j in new_jobs[:40]:
        if j["metro"] != cur:
            cur = j["metro"]; lines.append(f"[{cur}]")
        loc = j.get("location") or ""
        lines.append(f"  • {j['firm']} — {j['title']} · {loc}\n    {j['url']}")
    more = n - min(n, 40)
    if more > 0:
        lines.append(f"  …and {more} more new role{'s' if more != 1 else ''}.")
    lines += ["", f"Open the dashboard: {dash_url}"]
    return "\n".join(lines)


# Sunday is a rest day: no roles, just a warm note. Anything found on Sunday is
# held back and folded into Monday's digest (see send_newsletter's Monday case).
SUNDAY_MESSAGE = (
    "Good morning, Ms Tian — have a lovely Sunday doing your favourite thing. "
    "You deserve to relax a bit \U0001f642"
)


def _sunday_html(today, dash_url):
    """A single-note Sunday email: the dashboard theme, none of the roles."""
    BG, PANEL = "#f7d7e0", "#fdf7ee"
    INK, SOFT, LINE = "#2a1620", "#9c7683", "#e9c3d1"
    GREEN, ON_GREEN, ROSE = "#17392a", "#fdf3e2", "#cf5f89"
    SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
    MONO = "'IBM Plex Mono', ui-monospace, 'Courier New', monospace"
    SANS = "'IBM Plex Sans', -apple-system, Segoe UI, Arial, sans-serif"
    fonts = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;"
             "1,9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap")
    return f"""\
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<link rel="stylesheet" href="{fonts}">
</head><body style="margin:0;background:{BG};padding:26px 12px;font-family:{SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:{PANEL};border-radius:18px;overflow:hidden;border:1px solid {LINE};box-shadow:0 8px 24px rgba(42,22,32,.10)">

<tr><td style="padding:32px 34px 8px;background:linear-gradient(135deg,#f8dde8 0%,{PANEL} 60%)">
  <div style="font-family:{MONO};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:{ROSE};padding-bottom:8px">✿ Sunday</div>
  <div style="font-family:{SERIF};font-weight:600;font-size:38px;line-height:1.05;color:{INK};letter-spacing:-.01em">Street <em style="font-style:italic;color:{ROSE}">Watch</em></div>
  <div style="font-family:{SANS};font-size:14px;color:{SOFT};padding-top:8px">{today}</div>
</td></tr>

<tr><td style="padding:24px 34px 8px;font-family:{SERIF};font-style:italic;font-size:22px;line-height:1.4;color:{INK}">
  {SUNDAY_MESSAGE}
</td></tr>

<tr><td style="padding:8px 34px 6px;font-family:{SERIF};font-size:16px;color:{SOFT}">
  No roundup today — I'll gather anything that comes in and bring it to you tomorrow morning.
</td></tr>

<tr><td style="padding:18px 34px 34px" align="center">
  <a href="{_esc(dash_url)}" style="display:inline-block;background:{GREEN};color:{ON_GREEN};font-family:{SANS};font-weight:600;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:999px">Peek at the board →</a>
</td></tr>
</table>
<div style="font-family:{MONO};font-size:10.5px;letter-spacing:.06em;color:{SOFT};padding:18px 0 0">STREET WATCH · Sundays are for resting</div>
</td></tr></table></body></html>"""


def _sunday_text(today, dash_url):
    return "\n".join([
        f"Street Watch — {today}",
        "",
        SUNDAY_MESSAGE,
        "",
        "No roundup today — I'll gather anything that comes in and bring it to you tomorrow morning.",
        "",
        f"The board is always here: {dash_url}",
    ])


def send_newsletter(jobs, today):
    """Email a morning digest of today's NEW roles over SMTP (Gmail or any host).

    Opt-in and non-fatal: if the SMTP env isn't set we skip quietly, and any
    send error is logged but never crashes the daily run. Set
    NEWSLETTER_SEND_EMPTY=1 to still send on a zero-new day (default: skip).

    Env:
      SMTP_HOST      e.g. smtp.gmail.com          (required)
      SMTP_PORT      587 STARTTLS / 465 SSL       (default 587)
      SMTP_USER      login username / from addr   (required)
      SMTP_PASSWORD  password or app-password     (required)
      NEWSLETTER_TO  recipients, comma/semicolon-separated (required)
      NEWSLETTER_FROM  From header (default: SMTP_USER)
      DASHBOARD_URL    CTA link (default the Vercel site)
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.utils import formataddr

    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    to = os.getenv("NEWSLETTER_TO")
    if not (host and user and password and to):
        print("Newsletter SMTP env not set (SMTP_HOST/SMTP_USER/SMTP_PASSWORD/NEWSLETTER_TO) — skipping email.")
        return
    port = int(os.getenv("SMTP_PORT") or "587")  # empty-string env (unset CI var) -> default
    sender = os.getenv("NEWSLETTER_FROM") or formataddr(("Street Watch", user))
    dash_url = os.getenv("DASHBOARD_URL") or "https://street-watch.vercel.app"
    recipients = [a.strip() for a in re.split(r"[,;]", to) if a.strip()]

    # Weekday drives what we send (from the UTC date the daily run stamps roles with):
    #   Sunday  -> a rest-day note only, no roles (Sunday's finds are held back).
    #   Monday  -> today's new roles PLUS Sunday's (which we skipped yesterday).
    #   else    -> just today's new roles.
    weekday = datetime.strptime(today, "%Y-%m-%d").weekday()  # Mon=0 … Sun=6

    if weekday == 6:  # Sunday
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Street Watch — enjoy your Sunday, Ms Tian ✿"
        msg["From"] = sender
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(_sunday_text(today, dash_url), "plain", "utf-8"))
        msg.attach(MIMEText(_sunday_html(today, dash_url), "html", "utf-8"))
        if _smtp_send(host, port, user, password, recipients, msg):
            print(f"  newsletter sent to {len(recipients)} recipient(s) (Sunday rest note)")
            return True
        return False

    if weekday == 0:  # Monday — fold in Sunday's held-back roles by first_seen
        yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        window = {today, yesterday}
        new_jobs = [j for j in jobs if j.get("first_seen") in window]
    else:
        new_jobs = [j for j in jobs if j.get("is_new")]

    if not new_jobs and os.getenv("NEWSLETTER_SEND_EMPTY", "") not in ("1", "true", "yes"):
        print("Newsletter: no new roles today — skipping email (set NEWSLETTER_SEND_EMPTY=1 to force).")
        return

    n = len(new_jobs)
    subject = (f"Street Watch — {n} new role{'s' if n != 1 else ''} this morning"
               if n else "Street Watch — no new roles today")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(_newsletter_text(new_jobs, len(jobs), today, dash_url), "plain", "utf-8"))
    msg.attach(MIMEText(_newsletter_html(new_jobs, len(jobs), today, dash_url), "html", "utf-8"))

    if _smtp_send(host, port, user, password, recipients, msg):
        print(f"  newsletter sent to {len(recipients)} recipient(s) ({n} new roles)")
        return True
    return False


def _smtp_send(host, port, user, password, recipients, msg):
    """Deliver a built message over SMTP. Non-fatal: logs and returns False on
    any error so the daily run never crashes on a mail hiccup."""
    import smtplib
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT)
        else:
            server = smtplib.SMTP(host, port, timeout=TIMEOUT)
            server.starttls()
        with server:
            server.login(user, password)
            server.sendmail(user, recipients, msg.as_string())
        return True
    except Exception as e:
        print(f"  ! newsletter send failed: {e}", file=sys.stderr)
        return False


# ---------------------------------------------------------------- main
def main():
    # Job titles carry en-dashes/smart quotes; the Windows console defaults to
    # cp1252, which can't encode them and would crash the final summary print
    # (the Linux CI runner is UTF-8, so it never hit this). Force UTF-8 out.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    jobs = collect()

    new = 0
    for j in jobs:
        if j["id"] not in state:
            state[j["id"]] = today; new += 1
        j["first_seen"] = state[j["id"]]
        j["is_new"] = state[j["id"]] == today
    json.dump(state, open(STATE_FILE, "w"))

    jobs.sort(key=lambda j: (j["metro"], j["firm"], j["title"]))
    json.dump(jobs, open("street_watch_jobs.json", "w"), indent=2)
    with open("street_watch_jobs.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["metro","firm","title","location","source","posted_date","first_seen","is_new","url"])
        for j in jobs:
            w.writerow([j["metro"], j["firm"], j["title"], j["location"], j["source"],
                        j.get("posted_date"), j["first_seen"], j["is_new"], j["url"]])

    push_supabase(jobs)

    # Several triggers can fire on the same day (backup crons, a late GitHub
    # schedule, an external dispatch, a manual run) — only the first one mails.
    # NEWSLETTER_FORCE=1 overrides for a deliberate re-send.
    if state.get(NEWSLETTER_SENT_KEY) == today and os.getenv("NEWSLETTER_FORCE", "") not in ("1", "true", "yes"):
        print(f"Newsletter already sent today ({today}) — skipping (set NEWSLETTER_FORCE=1 to re-send).")
    elif send_newsletter(jobs, today):
        state[NEWSLETTER_SENT_KEY] = today
        json.dump(state, open(STATE_FILE, "w"))

    print(f"\n=== {today}: {len(jobs)} roles ({new} new) ===")
    cur = None
    for j in jobs:
        if j["metro"] != cur:
            cur = j["metro"]; print(f"\n### {cur}")
        print(f"  {'*NEW* ' if j['is_new'] else ''}{j['firm']} — {j['title']} · {j['location']}")


if __name__ == "__main__":
    main()
