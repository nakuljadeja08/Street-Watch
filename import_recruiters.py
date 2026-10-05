#!/usr/bin/env python3
"""
Load a recruiter list (a Custom Databanks "Executive Search System" PDF export)
into Supabase: recruiter_firms + recruiter_contacts (schema_recruiters.sql).

The list is private. This script reads it from wherever you keep it and writes
straight to Supabase with the service key; nothing from the list is written to
this repo (which is public) or printed beyond counts.

    pip install pymupdf requests
    python import_recruiters.py "C:/Users/you/Desktop/Recruiter.pdf"           # load
    python import_recruiters.py "C:/Users/you/Desktop/Recruiter.pdf" --dry-run # parse + counts only

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (from .env or the environment).
Re-running upserts by id, so outreach rows keep pointing at the same contacts.
"""
from __future__ import annotations
import json, os, re, sys
import requests

# ---------------------------------------------------------------- codes
# Each contact carries the list's 3-letter industry/position codes. Contacts
# without them inherit codes derived from the firm's industry/position text.
IND_FROM_TEXT = [
    ("financial services", "FIN"), ("investment bank", "INV"), ("investment bank", "BAN"),
    ("banking", "BAN"), ("private equity", "VEN"), ("venture capital", "VEN"),
    ("fintech", "FTC"), ("hedge fund", "INV"), ("asset management", "INV"), ("brokerage", "BRK"),
    ("hi-tech", "HIT"), ("software", "SFT"), ("saas", "SFT"), ("internet", "WWW"),
    ("world wide web", "WWW"), ("e-commerce", "WWW"), ("big data", "BIG"), ("cyber", "CYB"),
    ("insurance", "INS"), ("real estate", "REA"), ("retail", "RTL"), ("consumer", "CSG"),
    ("luxury", "RTL"), ("fashion", "RTL"), ("consulting", "CON"), ("healthcare", "HEA"),
    ("most industries", "GEN"),
]
POS_FROM_TEXT = [
    ("financial analysis", "FIN"), ("chief financial officer", "FIN"), ("financial,", "FIN"),
    ("quantitative analysis", "QNT"), ("data analysis", "QNT"), ("data science", "QNT"),
    ("business intelligence", "QNT"), ("information technology", "MIS"), ("systems development", "MIS"),
    ("technical", "TEC"), ("engineering", "TEC"), ("risk management", "RIS"),
    ("regulatory", "REG"), ("marketing", "MAR"), ("product manager", "MAR"), ("sales", "SAL"),
    ("mergers", "MNA"), ("operations", "OPS"), ("senior management", "SEN"),
]

# What each watch looks for in a recruiter (industry ∩ and position ∩ must both hit).
WATCH = {
    "street": dict(ind={"FIN", "BAN", "INV", "VEN", "FTC", "BRK", "CMM"},
                   pos={"FIN", "QNT", "RIS", "MNA", "REG", "OPS"}),
    "tech": dict(ind={"HIT", "SFT", "WWW", "BIG", "CYB", "CMP", "APP", "FTC", "FIN", "BAN", "INV"},
                 pos={"QNT", "MIS", "TEC"}),
}
_SENIOR_RE = re.compile(r"partner|founder|\bceo\b|president|managing director|principal|owner|chair|\bhead\b", re.I)


def level_of(title):
    return "senior" if _SENIOR_RE.search(title or "") else "recruiter"


def score(watch, firm, contact):
    """Outreach fit, or None when the recruiter doesn't cover this watch.
    Favours contingency firms (they work with candidates), lower salary floors,
    recruiter-level people, and overlap with the watch's industries/positions."""
    w = WATCH[watch]
    ind = set(contact["ind_codes"]) & w["ind"]
    pos = set(contact["pos_codes"]) & w["pos"]
    if "GEN" in contact["ind_codes"] and not ind:
        ind = {"GEN"}
    if not ind or not pos:
        return None
    t = (firm["type"] or "").lower()
    s = 30 if t.startswith("contingency") else 4 if "aesc" in t else 12
    sal = firm["min_salary"] or 999999
    s += 15 if sal <= 100000 else 8 if sal <= 125000 else 3 if sal <= 150000 else 0
    s += 15 if contact["level"] == "recruiter" else 5
    s += 5 * min(4, len(ind)) + 6 * min(3, len(pos))
    return s


# ---------------------------------------------------------------- parsing
CONTACT_START_RE = re.compile(r"^(?:Mr|Ms|Mrs|Miss|Dr)\.\s", re.M)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _field(block, name):
    m = re.search(rf"^{re.escape(name)}\s*:\s*(.*?)(?=^(?:Minimum salary for assignments|Recruiter type|Industries|"
                  rf"Positions|Website|Location \(HQ\)|Location|Phone|Contacts?)\s*:|\Z)", block, re.S | re.M)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def _contacts(text, firm_id):
    out = []
    starts = [m.start() for m in CONTACT_START_RE.finditer(text)]
    for a, b in zip(starts, starts[1:] + [len(text)]):
        c = re.sub(r"\s+", " ", text[a:b]).strip()
        email = (re.search(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+", c) or [None])[0]
        ind = re.search(r"Industries:\s*([A-Z]{3}(?:/[A-Z]{3})*)", c)
        pos = re.search(r"Positions:\s*([A-Z]{3}(?:/[A-Z]{3})*)", c)
        head = c.split(" / ")[0]
        name, _, title = head.partition(",")
        name = re.sub(r"^(?:Mr|Ms|Mrs|Miss|Dr)\.\s+", "", name).strip()
        if not name:
            continue
        out.append(dict(id=f"{firm_id}--{slug(name)}", firm_id=firm_id, name=name, title=title.strip(),
                        email=email.rstrip(".") if email else None,
                        ind_codes=ind.group(1).split("/") if ind else [],
                        pos_codes=pos.group(1).split("/") if pos else []))
    return out


def parse(pdf_path):
    import pymupdf
    doc = pymupdf.open(pdf_path)
    text = "\n".join(p.get_text() for p in doc)
    text = re.sub(r"(?m)^Page \d+\s*$\n?", "", text)
    lines = text.split("\n")
    # A record's first line (the firm name) sits right above its first
    # "From the website:" or "Minimum salary…" line; find each record by its
    # "Recruiter type:" line and walk back to that start.
    rt_idx = [i for i, l in enumerate(lines) if l.startswith("Recruiter type:")]
    starts = []
    prev = 0
    for i in rt_idx:
        j = next(k for k in range(prev, i + 1)
                 if lines[k].startswith(("From the website:", "Minimum salary for assignments:")))
        j -= 1
        while j > prev and not lines[j].strip():   # a blank line can sit above the name
            j -= 1
        starts.append(j)
        prev = i + 1
    firms, contacts = [], []
    for n, s in enumerate(starts):
        e = starts[n + 1] if n + 1 < len(starts) else len(lines)
        block = "\n".join(lines[s:e])
        name = lines[s].strip()
        fid = slug(name)
        about_m = re.search(r"^From the website:\s*(.*?)(?=^Minimum salary for assignments:)", block, re.S | re.M)
        sal = re.search(r"Minimum salary for assignments:\s*\$([\d,]+)", block)
        hq = _field(block, "Location (HQ)") or _field(block, "Location")
        firm = dict(id=fid, name=name, type=_field(block, "Recruiter type"),
                    min_salary=int(sal.group(1).replace(",", "")) if sal else None,
                    website=_field(block, "Website") or None, phone=_field(block, "Phone") or None,
                    hq=hq or None,
                    about=re.sub(r"\s+", " ", about_m.group(1)).strip()[:2000] if about_m else None,
                    industries=_field(block, "Industries"), positions=_field(block, "Positions"))
        firms.append(firm)
        cm = re.search(r"^Contacts?:\s*$", block, re.M)   # "Contact:" when there is one
        if cm:
            contacts += _contacts(block[cm.end():], fid)
    return firms, contacts


def enrich(firms, contacts):
    by_id = {f["id"]: f for f in firms}
    for c in contacts:
        f = by_id[c["firm_id"]]
        c["codes_derived"] = not (c["ind_codes"] and c["pos_codes"])
        if not c["ind_codes"]:
            fi = f["industries"].lower()
            c["ind_codes"] = sorted({code for k, code in IND_FROM_TEXT if k in fi})
        if not c["pos_codes"]:
            fp = f["positions"].lower() + ","
            c["pos_codes"] = sorted({code for k, code in POS_FROM_TEXT if k in fp})
        c["level"] = level_of(c["title"])
        c["street_score"] = score("street", f, c)
        c["tech_score"] = score("tech", f, c)
    # same person listed twice at one firm → keep the first
    seen, out = set(), []
    for c in contacts:
        if c["id"] not in seen:
            seen.add(c["id"]); out.append(c)
    return out


# ---------------------------------------------------------------- load
def _env():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                os.environ.setdefault(m.group(1), m.group(2))
    return os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")


def upsert(url, key, table, rows):
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    for i in range(0, len(rows), 200):
        r = requests.post(f"{url}/rest/v1/{table}?on_conflict=id", headers=h,
                          data=json.dumps(rows[i:i + 200]), timeout=60)
        if r.status_code >= 300:
            sys.exit(f"{table} upsert failed ({r.status_code}): {r.text[:300]}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    firms, contacts = parse(args[0])
    contacts = enrich(firms, contacts)
    types = {}
    for f in firms:
        types[f["type"]] = types.get(f["type"], 0) + 1
    print(f"parsed {len(firms)} firms, {len(contacts)} contacts  {types}")
    print(f"  contacts with their own codes: {sum(not c['codes_derived'] for c in contacts)}")
    print(f"  relevant to Street Watch: {sum(c['street_score'] is not None for c in contacts)}"
          f"   Tech Watch: {sum(c['tech_score'] is not None for c in contacts)}")
    if "--dry-run" in sys.argv:
        return
    url, key = _env()
    if not (url and key):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set.")
    upsert(url, key, "recruiter_firms", firms)
    upsert(url, key, "recruiter_contacts", contacts)
    print("loaded into Supabase.")


if __name__ == "__main__":
    main()
