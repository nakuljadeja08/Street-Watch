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
    "Sixth Street": "sixthstreet", "General Atlantic": "generalatlantic",
    "TPG": "tpgcareers", "Warburg Pincus": "warburgpincusllc",
    "iCapital": "icapitalnetwork", "CAIS": "cais", "BTIG": "btig27",
    "StepStone": "stepstone",                       # confirmed live (private markets)
    "KKR": "stage",                                 # KKR embeds Greenhouse board token "stage"
    "William Blair": "williamblair", "EQT": "eqtpartners",
    "Ducera Partners": "ducerapartners", "LionTree": "liontree",
    "PJT Partners": "pjtpartnersprofessionals",     # may 404 — handled gracefully
    # Consulting firms (added 2026-09-17 at client request) — both expose the
    # standard public Greenhouse board JSON on the US host.
    "Mars & Co": "marscousg",                        # NY-area consulting roles only
    "Altman Solon": "altmansolonuslp",               # TMT strategy; US + EU board
    "Solomon Partners": "solomonpartnersprofessionals",  # yellow-tier (advisory)
}
ASHBY = {        # firm -> job board name (api.ashbyhq.com/posting-api/job-board/<name>)
    "Insight Partners": "insightpartners",          # verify the exact board slug
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
    "Franklin Templeton":       ("franklintempleton", "wd5", "Primary-External-1"),
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
    # Best-effort tenant/site slugs from public careers URLs — a wrong site just
    # logs an error for that firm and skips it; correct it from the run output.
    # Still to map (custom / not-yet-found ATS): JPMorgan, Jefferies, Evercore,
    #   Centerview, Rothschild, Nomura, RBC, HSBC, UBS, BNP, SocGen, PIMCO, HPS.
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


# ---------------------------------------------------------------- fetchers
def _posted(val):
    """Normalize an ISO timestamp to a YYYY-MM-DD date string, else None.
    (Supabase `posted_date` is a DATE column; nulls are fine.)"""
    if not val or not isinstance(val, str) or len(val) < 10:
        return None
    d = val[:10]
    return d if d[:4].isdigit() and d[4] == "-" else None


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
                                source="workday", posted_date=None))
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
                                # Workday's list payload carries no post date (would
                                # need a per-job detail fetch); leave null.
                                posted_date=None))
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
}
RADANCY_METRO_KW = ["new york", "jersey city", "chicago", "san francisco", "bay area"]
RADANCY_CARD_RE = re.compile(
    r'<a\b([^>]*?/job/[^>]*?)>(.*?)</a>'
    r'.*?class="[^"]*job-location[^"]*"[^>]*>\s*(.*?)\s*</', re.S)
RADANCY_HREF_RE = re.compile(r'href="([^"]+)"')
RADANCY_JID_RE = re.compile(r'data-job-id="(\d+)"')
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
                items = RADANCY_CARD_RE.findall(frag)
                if not items:
                    break
                for attrs, title_html, loc in items:
                    hm = RADANCY_HREF_RE.search(attrs)
                    if not hm:
                        continue
                    href = hm.group(1).strip()
                    jm = RADANCY_JID_RE.search(attrs)
                    jid = jm.group(1) if jm else href.rstrip("/").rsplit("/", 1)[-1]
                    if jid in seen:
                        continue
                    seen.add(jid)
                    title = _html.unescape(re.sub(r"\s+", " ", _TAG_RE.sub("", title_html))).strip()
                    loc_str = _html.unescape(re.sub(r"\s+", " ", loc)).strip()
                    url = href if href.startswith("http") else f"https://{host}{href}"
                    out.append(dict(firm=firm, id=f"{source}-{jid}", title=title,
                                    location=loc_str, url=url, source=source, posted_date=None))
                if len(items) < 100:
                    break
                page += 1
                time.sleep(0.25)
    except Exception as e:
        print(f"  ! {source} {firm}: {e}", file=sys.stderr)
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
    # upsert in chunks — a network/HTTP failure here must not crash the run
    # (the JSON/CSV are already written; a daily cron should exit cleanly).
    for i in range(0, len(rows), 200):
        chunk = rows[i:i+200]
        try:
            r = requests.post(endpoint, headers=headers, data=json.dumps(chunk), timeout=TIMEOUT)
        except Exception as e:
            print(f"  ! supabase request failed: {e}", file=sys.stderr); continue
        if r.status_code >= 300:
            print(f"  ! supabase {r.status_code}: {r.text[:200]}", file=sys.stderr)
        else:
            print(f"  upserted {len(chunk)} rows")

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


# ---------------------------------------------------------------- main
def main():
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

    print(f"\n=== {today}: {len(jobs)} roles ({new} new) ===")
    cur = None
    for j in jobs:
        if j["metro"] != cur:
            cur = j["metro"]; print(f"\n### {cur}")
        print(f"  {'*NEW* ' if j['is_new'] else ''}{j['firm']} — {j['title']} · {j['location']}")


if __name__ == "__main__":
    main()
