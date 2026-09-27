#!/usr/bin/env python3
"""
Tech Watch — data engineering job pipeline
==========================================

Street Watch's sibling. Pulls data engineering roles (new grad to mid level,
roughly 0-4 years) from tech, fintech and finance firms anywhere in the US,
flags what's new, writes tech_watch_jobs.json + .csv, upserts Supabase
`tech_jobs`, records hiring trends in `tech_hiring_trends` and emails the
Tech Watch morning digest.

It reuses pipeline.py's fetchers and Supabase/trends/SMTP helpers, but keeps
its own firm list, title and location rules, tables and state files, so the
two watches never touch each other's data.

    pip install requests cloudscraper
    python tech_pipeline.py
"""
from __future__ import annotations
import csv, json, os, re, sys, time
from datetime import datetime, timezone, timedelta
import requests

import pipeline as P
from pipeline import UA, TIMEOUT, _esc, _signed

STATE_FILE = ".tech_watch_state.json"
TRENDS_FILE = ".tech_watch_trends.json"
JOBS_JSON, JOBS_CSV = "tech_watch_jobs.json", "tech_watch_jobs.csv"
TABLES = dict(jobs="tech_jobs", apps="tech_applications",
              trends="tech_hiring_trends", searches="tech_saved_searches")
SEARCH = "data engineer"
# Data engineering reqs stay open longer than banking ones (evergreen team
# reqs), so still-listed roles are kept up to 60 days after posting.
MAX_AGE_DAYS = 60

# ---------------------------------------------------------------- registries
# Boards confirmed live on 2026-09-27 (see TECH_FIRMS.md). Grouped by sector;
# the sector is stored on each row and drives the dashboard's sector filter.
GREENHOUSE = {
    "Tech": {
        "Anthropic": "anthropic", "DoorDash": "doordashusa", "Sigma Computing": "sigmacomputing",
        "Samsara": "samsara", "Figma": "figma", "Airbnb": "airbnb", "Lyft": "lyft",
        "Pinterest": "pinterest", "Reddit": "reddit", "Dropbox": "dropbox", "Twilio": "twilio",
        "Cloudflare": "cloudflare", "Datadog": "datadog", "MongoDB": "mongodb",
        "Elastic": "elastic", "Okta": "okta", "Databricks": "databricks", "Fivetran": "fivetran",
        "Starburst": "starburst", "Scale AI": "scaleai", "Asana": "asana", "Discord": "discord",
        "Roblox": "roblox", "Duolingo": "duolingo", "Flexport": "flexport", "Vercel": "vercel",
        "GitLab": "gitlab", "Waymo": "waymo", "Nuro": "nuro", "Lucid Motors": "lucidmotors",
        "Tripadvisor": "tripadvisor", "Squarespace": "squarespace", "Peloton": "peloton",
        "Instacart": "instacart",
    },
    "Fintech": {
        "Brex": "brex", "Stripe": "stripe", "Robinhood": "robinhood", "Coinbase": "coinbase",
        "Affirm": "affirm", "SoFi": "sofi", "Chime": "chime", "Mercury": "mercury",
        "Toast": "toast", "Carta": "carta", "Addepar": "addepar1", "Gemini": "gemini",
        "Ripple": "ripple", "Block": "block", "Gusto": "gusto", "Betterment": "betterment",
    },
    "Finance": {
        "Point72": "point72", "Jump Trading": "jumptrading", "Akuna Capital": "akunacapital",
        "Tower Research Capital": "towerresearchcapital", "Schonfeld": "schonfeld",
    },
}
ASHBY = {
    "Tech": {
        "OpenAI": "openai", "Modal": "modal", "Benchling": "benchling", "Snowflake": "snowflake",
        "Notion": "notion", "Linear": "linear", "Vanta": "vanta", "Cursor": "cursor",
        "Perplexity": "perplexity", "Replit": "replit", "Supabase": "supabase",
    },
    "Fintech": {"Ramp": "ramp", "Plaid": "plaid", "Kraken": "kraken.com"},
}
LEVER = {
    "Tech": {"Palantir": "palantir", "Spotify": "spotify"},
    "Fintech": {"Wealthfront": "wealthfront"},
}
WORKDAY = {      # firm -> (tenant, datacenter, site), searched for SEARCH
    "Tech": {
        "NVIDIA": ("nvidia", "wd5", "NVIDIAExternalCareerSite"),
        "Salesforce": ("salesforce", "wd12", "External_Career_Site"),
        "Adobe": ("adobe", "wd5", "external_experienced"),
        "Intel": ("intel", "wd1", "External"),
        "Cisco": ("cisco", "wd5", "Cisco_Careers"),
        "HP": ("hp", "wd5", "ExternalCareerSite"),
        "Autodesk": ("autodesk", "wd1", "Ext"),
        "CrowdStrike": ("crowdstrike", "wd5", "crowdstrikecareers"),
        "Workday": ("workday", "wd5", "Workday"),
        "Zoom": ("zoom", "wd5", "Zoom"),
        "Snap": ("snapchat", "wd1", "snap"),
        "Target": ("target", "wd5", "targetcareers"),
        "Disney": ("disney", "wd5", "disneycareer"),
    },
    "Fintech": {
        "PayPal": ("paypal", "wd1", "jobs"),
        "Visa": ("visa", "wd5", "Visa"),
        "Mastercard": ("mastercard", "wd1", "CorporateCareers"),
        "Synchrony": ("synchronyfinancial", "wd5", "careers"),
    },
    "Finance": {
        "Northern Trust": ("ntrs", "wd1", "northerntrust"),
        "Fidelity": ("fmr", "wd1", "FidelityCareers"),
        "T. Rowe Price": ("troweprice", "wd5", "TRowePrice"),
        "Nasdaq": ("nasdaq", "wd1", "Global_External_Site"),
        "S&P Global": ("spgi", "wd5", "SPGI_Careers"),
        "Morningstar": ("morningstar", "wd5", "Americas"),
    },
}

# Street Watch's finance firms are scanned too, minus the consulting shops
# (Tech Watch covers tech and finance only).
_STREET_CAT = P._FIRM_CAT
def _street(reg):
    return {f: v for f, v in reg.items() if _STREET_CAT.get(f) != "Consulting"}

SECTOR = {}
for _reg in (GREENHOUSE, ASHBY, LEVER, WORKDAY):
    for _sec, _firms in _reg.items():
        for _f in _firms:
            SECTOR[_f] = _sec
for _f in P.registered_firms():
    if _STREET_CAT.get(_f) != "Consulting":
        SECTOR.setdefault(_f, "Fintech" if _STREET_CAT.get(_f) == "Fintech" else "Finance")
SECTOR["Amazon"] = "Tech"


# ---------------------------------------------------------------- new fetchers
def fetch_lever(firm, name):
    try:
        r = requests.get(f"https://api.lever.co/v0/postings/{name}?mode=json",
                         headers=UA, timeout=TIMEOUT); r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ! lever {firm}: {e}", file=sys.stderr); return []
    out = []
    for j in data if isinstance(data, list) else []:
        cats = j.get("categories") or {}
        locs = cats.get("allLocations") or [cats.get("location") or ""]
        ts = j.get("createdAt")
        out.append(dict(firm=firm, id=f"lever-{name}-{j.get('id')}",
                        title=(j.get("text") or "").strip(),
                        location="; ".join(l for l in locs if l),
                        url=j.get("hostedUrl", ""), source="lever",
                        posted_date=(datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d")
                                     if isinstance(ts, (int, float)) else None)))
    return out


def fetch_amazon(query=SEARCH, max_rows=1500):
    """amazon.jobs public search JSON (US only, newest first)."""
    out, offset, total = [], 0, None
    try:
        while offset < max_rows:
            r = requests.get("https://www.amazon.jobs/en/search.json", headers=UA, timeout=TIMEOUT,
                             params={"base_query": query, "country": "USA", "result_limit": 100,
                                     "offset": offset, "sort": "recent"})
            r.raise_for_status()
            d = r.json()
            total = d.get("hits", 0) if total is None else total
            jobs = d.get("jobs") or []
            if not jobs:
                break
            for j in jobs:
                try:
                    posted = datetime.strptime(" ".join((j.get("posted_date") or "").split()),
                                               "%B %d, %Y").strftime("%Y-%m-%d")
                except ValueError:
                    posted = None
                out.append(dict(firm="Amazon", id=f"amazon-{j.get('id_icims')}",
                                title=(j.get("title") or "").strip(),
                                location=j.get("normalized_location") or j.get("location") or "",
                                url="https://www.amazon.jobs" + (j.get("job_path") or ""),
                                source="amazon", posted_date=posted))
            offset += 100
            if offset >= total:
                break
            time.sleep(0.25)
    except Exception as e:
        print(f"  ! amazon: {e}", file=sys.stderr)
    return out


_MULTI_LOC_RE = re.compile(r"^\d+\s+locations?$", re.I)


def fetch_workday(firm, tenant, dc, site):
    """Search a Workday board for SEARCH, then resolve "3 Locations" rows (Workday
    hides the list behind the job detail) for roles that pass the title filter."""
    rows = P.fetch_workday(firm, tenant, dc, site, search_text=SEARCH, relevant=_looks_de)
    base = f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
    for r in rows:
        if not (_MULTI_LOC_RE.match(r["location"]) and title_ok(r["title"])):
            continue
        path = r["url"].split(f"/{site}", 1)[-1]
        try:
            info = requests.get(base + path, headers=UA, timeout=TIMEOUT).json().get("jobPostingInfo") or {}
            locs = [info.get("location")] + list(info.get("additionalLocations") or [])
            r["location"] = "; ".join(l for l in locs if l) or r["location"]
            r["posted_date"] = r["posted_date"] or P._posted(info.get("startDate"))
        except Exception as e:
            print(f"  ! workday detail {firm}: {e}", file=sys.stderr)
    return rows


# ---------------------------------------------------------------- filters
# In: data engineering titles. Out: senior grades, management, ML engineering,
# software engineering (any title with "software"), interns, pre-sales/architect
# roles, security and hardware "data center" jobs.
_DE_RE = re.compile(
    r"\bdata\s+(?:\w+\s+){0,2}?engineer"              # Data / Cloud Data / Data Platform Engineer
    r"|\bdata\s+engineering\b|\bdata\s+developer\b"
    r"|\banalytics\s+engineer"
    r"|\b(?:etl|elt)\b"
    r"|\bbig\s+data\b", re.I)
_DE_EXCLUDE_RE = re.compile(
    r"\b(?:senior|sr|staff|principal|lead|leader|manager|mgr|director|head|chief|"
    r"vp|avp|svp|evp|vice\s+president|distinguished|fellow|"
    r"intern|internship|co-?op|summer|apprentice|"
    r"architect|specialist|sales|presales|siem|software|"
    r"iii|iv)\b"
    r"|machine\s+learning\s+engineer|\bml\s*(?:ops)?\s+engineer|\bmlops\b"
    r"|data\s+cent(?:er|re)|data\s+(?:protection|security|privacy|loss)|part[\s-]?time"
    r"|\bengineer\s+[4-9]\b", re.I)


def _looks_de(title):
    return bool(_DE_RE.search(title))


def title_ok(title):
    return _looks_de(title) and not _DE_EXCLUDE_RE.search(title)


STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california",
    "CO": "colorado", "CT": "connecticut", "DE": "delaware", "FL": "florida", "GA": "georgia",
    "HI": "hawaii", "ID": "idaho", "IL": "illinois", "IN": "indiana", "IA": "iowa",
    "KS": "kansas", "KY": "kentucky", "LA": "louisiana", "ME": "maine", "MD": "maryland",
    "MA": "massachusetts", "MI": "michigan", "MN": "minnesota", "MS": "mississippi",
    "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada", "NH": "new hampshire",
    "NJ": "new jersey", "NM": "new mexico", "NY": "new york", "NC": "north carolina",
    "ND": "north dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon", "PA": "pennsylvania",
    "RI": "rhode island", "SC": "south carolina", "SD": "south dakota", "TN": "tennessee",
    "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington",
    "WV": "west virginia", "WI": "wisconsin", "WY": "wyoming", "DC": "district of columbia",
}
# Uppercase two-letter state code standing alone ("Austin, TX", "US-NY-New York",
# "TX - Plano"). Case-sensitive so "in"/"or"/"me" in running text never match.
_STATE_CODE_RE = re.compile(r"(?<![A-Za-z])(" + "|".join(STATES) + r")(?![A-Za-z])")
_STATE_NAME_RE = re.compile(r"\b(" + "|".join(sorted(STATES.values(), key=len, reverse=True)) + r")\b", re.I)
_US_RE = re.compile(r"united\s+states|\bu\.?s\.?a?\b|\bamerica[s]?\b", re.I)
_REMOTE_RE = re.compile(r"\bremote\b|\bvirtual\b|\banywhere\b", re.I)
_NON_US_RE = re.compile(
    r"\b(canada|ontario|toronto|montr[eé]al|qu[eé]bec|british columbia|alberta|calgary|nova scotia|"
    r"mexico|brazil|argentina|colombia|chile|costa rica|peru|"
    r"united kingdom|\buk\b|england|london|scotland|ireland|dublin|france|paris|germany|berlin|munich|"
    r"frankfurt|netherlands|amsterdam|spain|madrid|barcelona|portugal|lisbon|italy|milan|poland|"
    r"warsaw|krak[oó]w|romania|bucharest|switzerland|zurich|z[uü]rich|geneva|sweden|stockholm|"
    r"denmark|copenhagen|norway|finland|belgium|brussels|austria|vienna|czech|prague|hungary|"
    r"greece|israel|tel aviv|luxembourg|estonia|lithuania|ukraine|serbia|turkey|"
    r"india|bangalore|bengaluru|hyderabad|pune|mumbai|chennai|gurgaon|gurugram|noida|delhi|"
    r"singapore|hong kong|china|shanghai|beijing|shenzhen|hangzhou|taiwan|taipei|japan|tokyo|"
    r"korea|seoul|philippines|manila|malaysia|penang|kuala lumpur|vietnam|thailand|indonesia|"
    r"australia|sydney|melbourne|new zealand|uae|dubai|abu dhabi|saudi|qatar|south africa|"
    r"egypt|nigeria|kenya|emea|apac|latam|europe)\b", re.I)

# Hubs, most specific first. A role lands in the first hub any of its
# locations matches; otherwise "Remote (US)" or "Other US".
HUBS = [
    ("NYC Area", r"new york|\bnyc\b|brooklyn|jersey city|hoboken|newark|iselin|metropark|"
                 r"stamford|greenwich|white plains|princeton|mount laurel"),
    ("SF Bay Area", r"san francisco|bay area|palo alto|menlo park|mountain view|san mateo|"
                    r"redwood city|sunnyvale|san jose|santa clara|cupertino|oakland|"
                    r"foster city|emeryville|san bruno|fremont|milpitas|los gatos"),
    ("Seattle", r"seattle|bellevue|redmond|kirkland"),
    ("Chicago", r"chicago|evanston"),
    ("Boston", r"boston|cambridge,?\s*(?:ma|massachusetts)|somerville|waltham|burlington,?\s*ma|quincy"),
    ("Texas", r"austin|dallas|houston|plano|irving|fort worth|san antonio|frisco|richardson"),
    ("DC / Virginia", r"washington,?\s*(?:d\.?c|district)|\bdc\b|mclean|arlington|reston|herndon|"
                      r"richmond,?\s*(?:va|virginia)|tysons|alexandria|chantilly|bethesda|baltimore"),
    ("Los Angeles", r"los angeles|santa monica|culver city|irvine|pasadena|burbank|glendale|"
                    r"el segundo|playa vista|san diego"),
    ("Charlotte", r"charlotte"),
    ("Atlanta", r"atlanta|alpharetta"),
    ("Denver", r"denver|boulder"),
]
HUBS = [(name, re.compile(pat, re.I)) for name, pat in HUBS]
_SPLIT_RE = re.compile(r"\s*(?:;|\||•|·|•|�|\bor\b|\s/\s|\n)\s*")


def _part_us(part):
    """True if one location string is in the US (or remote-US), False if it's
    clearly abroad, None if it can't tell."""
    if _NON_US_RE.search(part):
        # "Remote - US or Canada" was already split; "New York, NY, United States"
        # never hits this, and a US state code overrides a stray match like
        # "London, KY".
        return bool(_STATE_CODE_RE.search(part) or _US_RE.search(part))
    if _US_RE.search(part) or _STATE_CODE_RE.search(part) or _STATE_NAME_RE.search(part):
        return True
    if any(rx.search(part) for _, rx in HUBS):
        return True
    return None


def us_hub(loc):
    """The US hub for a location string, or None when no location is in the US."""
    parts = [p for p in _SPLIT_RE.split(loc or "") if p.strip()] or [loc or ""]
    us_parts = [p for p in parts if _part_us(p)]
    if not us_parts:
        # a bare "Remote" (no country at all) is kept as remote-US
        if any(_REMOTE_RE.search(p) and _part_us(p) is None for p in parts):
            return "Remote (US)"
        return None
    for name, rx in HUBS:
        if any(rx.search(p) for p in us_parts):
            return name
    if any(_REMOTE_RE.search(p) for p in us_parts):
        return "Remote (US)"
    return "Other US"


# ---------------------------------------------------------------- collect
def _run(label, items, fn):
    print(label)
    out = []
    for f, args in items:
        rows = fn(f, *args) if isinstance(args, tuple) else fn(f, args)
        print(f"  {f:<28}{len(rows):>5}")
        out += rows
    return out


def _flat(reg):
    return [(f, v) for firms in reg.values() for f, v in firms.items()]


def collect():
    raw = []
    raw += _run("Greenhouse…", _flat(GREENHOUSE) + list(_street(P.GREENHOUSE).items()), P.fetch_greenhouse)
    raw += _run("Ashby…", _flat(ASHBY) + list(_street(P.ASHBY).items()), P.fetch_ashby)
    raw += _run("Lever…", _flat(LEVER), fetch_lever)
    raw += _run("Workday…", _flat(WORKDAY) + list(_street(P.WORKDAY).items()), fetch_workday)
    raw += _run("Workday (myworkdaysite)…", list(_street(P.WORKDAY_SITE).items()),
                lambda f, dc, t, s: P.fetch_workday_site(f, dc, t, s))
    raw += _run("Jibe/iCIMS…", list(_street(P.JIBE).items()), P.fetch_jibe)
    raw += _run("Oracle Recruiting…", list(_street(P.ORACLE).items()), P.fetch_oracle)
    raw += _run("HRM Direct…", list(_street(P.HRMDIRECT).items()), P.fetch_hrmdirect)
    raw += _run("PageUp…", list(_street(P.PAGEUP).items()), P.fetch_pageup)
    raw += _run("iCIMS…", list(_street(P.ICIMS).items()), P.fetch_icims)
    raw += _run("Radancy…", list(_street(P.RADANCY).items()),
                lambda f, host: P.fetch_radancy(f, host, f.lower().split()[0], keywords=[SEARCH]))
    raw += _run("Phenom People…", list(_street(P.PHENOM).items()), P.fetch_phenom)
    raw += _run("Eightfold…", list(_street(P.EIGHTFOLD).items()), P.fetch_eightfold)
    print("Goldman Sachs / Citadel Securities / Amazon…")
    for rows in (P.fetch_goldman("Goldman Sachs", search_text=SEARCH),
                 P.fetch_citadel("Citadel Securities"), fetch_amazon()):
        print(f"  {(rows[0]['firm'] if rows else '—'):<28}{len(rows):>5}")
        raw += rows

    kept, seen = [], set()
    for r in raw:
        if r["id"] in seen or not title_ok(r["title"]) or not P.age_ok(r.get("posted_date"), MAX_AGE_DAYS):
            continue
        hub = us_hub(r["location"])
        if hub:
            seen.add(r["id"])
            r["metro"] = hub
            r["sector"] = SECTOR.get(r["firm"], "Finance")
            kept.append(r)
    return kept, raw


def registered_firms():
    return set(SECTOR)


# ---------------------------------------------------------------- saved searches
def _matches_search(j, f):
    """Mirror of the Tech Watch dashboard's saved-search matcher."""
    if f.get("metro") not in (None, "", "all") and j.get("metro") != f["metro"]:
        return False
    if f.get("sector") not in (None, "", "all") and j.get("sector") != f["sector"]:
        return False
    needle = (f.get("q") or "").strip().lower()
    return not needle or needle in f"{j['firm']} {j['title']} {j.get('location') or ''}".lower()


# ---------------------------------------------------------------- newsletter
# Email look: the Tech Watch dashboard's light "dev tool" palette with a dark
# terminal header. Inline styles, light-only (email dark mode is unreliable).
BG, PANEL, INK, SOFT, FAINT, LINE = "#eef0f4", "#ffffff", "#0f1115", "#5b6270", "#8a919e", "#e4e7ec"
ACC, NEW, TERM, TERM_INK, TERM_DIM, AMBER, CYAN = "#2b59ff", "#0a8f5c", "#0d1117", "#c9d1d9", "#6e7681", "#e3b341", "#79c0ff"
SECT = {"Tech": ("#e8ecfd", "#3148c8"), "Fintech": ("#e6f4f1", "#0f766e"), "Finance": ("#fbf1dc", "#8a5a00")}
SANS = "'Geist', 'IBM Plex Sans', -apple-system, Segoe UI, Arial, sans-serif"
MONO = "'JetBrains Mono', 'Geist Mono', ui-monospace, 'Courier New', monospace"
FONTS = ("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&"
         "family=JetBrains+Mono:wght@400;500;700&display=swap")


def _tech_url(dash_url):
    return os.getenv("TECH_DASHBOARD_URL") or dash_url.rstrip("/") + "/tech"


def _pulse_html(p, url):
    if not p:
        return ""
    net = p["posted"] - p["removed"]
    def movers(title, items, color):
        if not items:
            return ""
        return (f'<div style="padding-top:10px;font-family:{MONO};font-size:10px;letter-spacing:.1em;'
                f'text-transform:uppercase;color:{FAINT}">{title}</div>'
                + "".join(f'<div style="font-family:{SANS};font-size:13px;color:{INK};padding:2px 0">'
                          f'{_esc(f)} <b style="color:{color};font-family:{MONO}">{_signed(d)}</b></div>'
                          for f, d, _n, _r in items))
    return f"""
<tr><td style="padding:6px 32px 8px">
  <div style="border-top:1px solid {LINE};padding-top:18px;font-family:{MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:{SOFT}">
    <a href="{_esc(P._trends_url(url))}" style="color:{ACC};text-decoration:none">$ trends --last {p['span']}d →</a></div>
  <div style="font-family:{MONO};font-size:14px;color:{INK};padding-top:8px">
    <b style="color:{ACC}">{p['posted']}</b> posted · <b style="color:#c2410c">{p['removed']}</b> taken down · net <b>{_signed(net)}</b></div>
  {movers("Growing", p["growing"], NEW)}{movers("Pulling back", p["shrinking"], "#c2410c")}
</td></tr>"""


def _newsletter_html(new_jobs, total, today, url, hits=(), pulse=None):
    CAP = 40
    rows, cur = [], None
    for j in new_jobs[:CAP]:
        if j["metro"] != cur:
            cur = j["metro"]
            rows.append(f'<tr><td style="padding:18px 0 6px;font-family:{MONO};font-size:11px;'
                        f'letter-spacing:.12em;text-transform:uppercase;color:{FAINT}"># {_esc(cur)}</td></tr>')
        bg, fg = SECT.get(j.get("sector"), SECT["Finance"])
        rows.append(
            f'<tr><td style="padding:10px 0;border-bottom:1px solid {LINE}">'
            f'<div style="font-family:{MONO};font-size:11px;color:{SOFT};padding-bottom:3px">'
            f'{_esc(j["firm"])} <span style="background:{bg};color:{fg};border-radius:4px;padding:1px 6px;'
            f'font-size:10px">{_esc((j.get("sector") or "").lower())}</span></div>'
            f'<a href="{_esc(j["url"])}" style="font-family:{SANS};font-weight:600;font-size:15px;'
            f'line-height:1.3;color:{INK};text-decoration:none">{_esc(j["title"])}</a>'
            f'<div style="font-family:{SANS};font-size:12.5px;color:{SOFT};padding-top:2px">{_esc(j.get("location") or "")}</div>'
            f'</td></tr>')
    more = len(new_jobs) - min(len(new_jobs), CAP)
    if more > 0:
        rows.append(f'<tr><td style="padding:12px 0 0;font-family:{MONO};font-size:12px;color:{SOFT}">'
                    f'… {more} more on the board</td></tr>')
    pins = "".join(
        f'<div style="padding:8px 0 4px;font-family:{MONO};font-size:11px;color:{ACC}">★ {_esc(name)} · {len(found)} new</div>'
        + "".join(f'<div style="font-family:{SANS};font-size:13.5px;padding:2px 0"><a href="{_esc(j["url"])}" '
                  f'style="color:{INK};text-decoration:none"><b>{_esc(j["title"])}</b></a>'
                  f' <span style="color:{SOFT}">· {_esc(j["firm"])} · {_esc(j.get("location") or "")}</span></div>'
                  for j in found[:8])
        for name, found in hits)
    pinned = (f'<tr><td style="padding:14px 32px 0"><div style="border:1px solid {LINE};border-left:3px solid {ACC};'
              f'border-radius:8px;padding:6px 14px 10px;background:#f7f9ff">{pins}</div></td></tr>') if pins else ""
    n = len(new_jobs)
    status = (f'<span style="color:#7ee787">✓</span> {n} new role{"s" if n != 1 else ""} since yesterday'
              if n else f'<span style="color:{TERM_DIM}">○</span> no new roles overnight')
    return f"""\
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<link rel="stylesheet" href="{FONTS}">
</head><body style="margin:0;background:{BG};padding:26px 12px;font-family:{SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:{PANEL};border-radius:12px;overflow:hidden;border:1px solid {LINE}">
<tr><td style="background:{TERM};padding:22px 32px 20px;font-family:{MONO};font-size:13px;line-height:1.7;color:{TERM_INK}">
  <div style="color:{TERM_DIM};font-size:11px">nakul@tech-watch: ~/jobs · {today}</div>
  <div style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-.02em;padding:6px 0 4px">tech_watch<span style="color:{CYAN}">▍</span></div>
  <div><span style="color:{CYAN}">❯</span> git pull --data-roles</div>
  <div>{status}</div>
  <div><span style="color:{AMBER}">{total}</span> live on the board</div>
</td></tr>
<tr><td style="padding:22px 32px 0;font-family:{SANS};font-size:17px;font-weight:600;color:{INK}">Good morning, Nakul.</td></tr>
{pinned}
<tr><td style="padding:4px 32px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{''.join(rows)}</table></td></tr>
{_pulse_html(pulse, url)}
<tr><td style="padding:18px 32px 32px" align="center">
  <a href="{_esc(url)}" style="display:inline-block;background:{INK};color:#ffffff;font-family:{MONO};font-weight:500;font-size:14px;text-decoration:none;padding:12px 26px;border-radius:8px">$ open tech-watch →</a>
</td></tr>
</table>
<div style="font-family:{MONO};font-size:10.5px;color:{FAINT};padding:16px 0 0">TECH WATCH · sent after the daily job pull</div>
</td></tr></table></body></html>"""


def _newsletter_text(new_jobs, total, today, url, hits=(), pulse=None):
    n = len(new_jobs)
    lines = [f"Tech Watch — {today}", "", "Good morning, Nakul.", "",
             f"{n} new data role{'s' if n != 1 else ''} since yesterday ({total} live)." if n
             else f"No new data roles overnight — {total} live on the board.", ""]
    for name, found in hits:
        lines.append(f"★ {name} — {len(found)} new")
        lines += [f"  • {j['firm']} — {j['title']} · {j.get('location') or ''}\n    {j['url']}" for j in found[:8]]
        lines.append("")
    cur = None
    for j in new_jobs[:40]:
        if j["metro"] != cur:
            cur = j["metro"]; lines.append(f"[{cur}]")
        lines.append(f"  • {j['firm']} — {j['title']} · {j.get('location') or ''}\n    {j['url']}")
    if n > 40:
        lines.append(f"  … {n - 40} more on the board.")
    lines += P._pulse_text(pulse, url)
    lines += ["", f"Open Tech Watch: {url}"]
    return "\n".join(lines)


def send_newsletter(jobs, today, trends=None):
    """Email the Tech Watch digest. Same SMTP env and recipients as Street
    Watch (NEWSLETTER_TO). Non-fatal; returns True when sent."""
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.utils import formataddr
    host, user, password, to = (os.getenv(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "NEWSLETTER_TO"))
    if not (host and user and password and to):
        print("Newsletter SMTP env not set — skipping email.")
        return False
    port = int(os.getenv("SMTP_PORT") or "587")
    url = _tech_url(os.getenv("DASHBOARD_URL") or "https://street-watch.vercel.app")
    recipients = [a.strip() for a in re.split(r"[,;]", to) if a.strip()]
    new_jobs = [j for j in jobs if j.get("is_new")]
    order = {name: i for i, (name, _) in enumerate(HUBS)}
    order.update({"Remote (US)": len(order), "Other US": len(order) + 1})
    new_jobs.sort(key=lambda j: (order.get(j["metro"], 99), j["firm"], j["title"]))
    n = len(new_jobs)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = (f"Tech Watch — {n} new data role{'s' if n != 1 else ''} this morning"
                      if n else "Tech Watch — no new data roles today")
    msg["From"] = os.getenv("TECH_NEWSLETTER_FROM") or formataddr(("Tech Watch", user))
    msg["To"] = ", ".join(recipients)
    hits = P.saved_search_hits(new_jobs, table=TABLES["searches"], matches=_matches_search)
    pulse = P.trend_summary(trends, today)
    msg.attach(MIMEText(_newsletter_text(new_jobs, len(jobs), today, url, hits, pulse), "plain", "utf-8"))
    msg.attach(MIMEText(_newsletter_html(new_jobs, len(jobs), today, url, hits, pulse), "html", "utf-8"))
    if P._smtp_send(host, port, user, password, recipients, msg):
        print(f"  tech newsletter sent to {len(recipients)} recipient(s) ({n} new roles)")
        return True
    return False


# ---------------------------------------------------------------- main
def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    jobs, raw = collect()

    new = 0
    for j in jobs:
        if j["id"] not in state:
            state[j["id"]] = today; new += 1
        j["first_seen"] = state[j["id"]]
        j["is_new"] = state[j["id"]] == today
    json.dump(state, open(STATE_FILE, "w"))

    jobs.sort(key=lambda j: (j["metro"], j["firm"], j["title"]))
    json.dump(jobs, open(JOBS_JSON, "w"), indent=2)
    with open(JOBS_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["metro", "sector", "firm", "title", "location", "source", "posted_date", "first_seen", "is_new", "url"])
        for j in jobs:
            w.writerow([j["metro"], j["sector"], j["firm"], j["title"], j["location"], j["source"],
                        j.get("posted_date"), j["first_seen"], j["is_new"], j["url"]])

    P.push_supabase(jobs, table=TABLES["jobs"], apps_table=TABLES["apps"], max_age_days=MAX_AGE_DAYS)

    trends = json.load(open(TRENDS_FILE)) if os.path.exists(TRENDS_FILE) else {}
    day_rows = P.update_trends(trends, jobs, {r["id"] for r in raw},
                               {r["firm"] for r in raw}, today, registered_firms())
    json.dump(trends, open(TRENDS_FILE, "w"), separators=(",", ":"))
    P.push_trends(day_rows, table=TABLES["trends"])

    if state.get(P.NEWSLETTER_SENT_KEY) == today and os.getenv("NEWSLETTER_FORCE", "") not in ("1", "true", "yes"):
        print(f"Tech newsletter already sent today ({today}) — skipping (set NEWSLETTER_FORCE=1 to re-send).")
    elif os.getenv("TECH_NEWSLETTER", "1") in ("0", "false", "no"):
        print("Tech newsletter disabled (TECH_NEWSLETTER=0).")
    elif send_newsletter(jobs, today, trends):
        state[P.NEWSLETTER_SENT_KEY] = today
        json.dump(state, open(STATE_FILE, "w"))

    print(f"\n=== {today}: {len(jobs)} data roles ({new} new) ===")
    cur = None
    for j in jobs:
        if j["metro"] != cur:
            cur = j["metro"]; print(f"\n### {cur}")
        print(f"  {'*NEW* ' if j['is_new'] else ''}[{j['sector']}] {j['firm']} — {j['title']} · {j['location']}")


if __name__ == "__main__":
    main()
