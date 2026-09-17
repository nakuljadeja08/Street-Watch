# Consulting firms — client add (2026-09-17)

Seven consulting firms requested by the client. Fingerprinted each firm's ATS via
a real browser session, then wired the ones with a clean public endpoint.

## ✅ Wired into `pipeline.py` (4)

| Firm | ATS | Endpoint | Notes |
|------|-----|----------|-------|
| Mars & Co | Greenhouse | `boards-api.greenhouse.io/v1/boards/marscousg/jobs` | 5 postings, all NY-area. Assoc. Consultant / Consultant flow through; "Summer …" variants now excluded as internships. |
| Altman Solon | Greenhouse | `…/boards/altmansolonuslp/jobs` | 15 postings (US + EU). Current US roles are Manager / Senior Consultant; Analyst/Associate/Consultant grades will appear as they open. |
| ZS Associates | Jibe / iCIMS | `jobs.zs.com/api/jobs?page=N` | ~275 postings, 10/page. `full_location` is multi-city; `posted_date` is ISO (honors the 30-day rule). New `fetch_jibe`. |
| CIL | Pinpoint | `careers.cil.com/postings.json` | Small board; **Analyst in NY and Chicago live today.** No post date in payload → kept undated. New `fetch_pinpoint`. |

Two are just registry entries (`GREENHOUSE`); two use new generic fetchers
(`fetch_jibe` + `JIBE`, `fetch_pinpoint` + `PINPOINT`) that will accept more firms
on the same platforms by adding one line.

Filter change made for these firms: `"consultant"` added to `TITLES` (so
consulting entry level is captured), and `"summer"` added to `EXCLUDE` (drops
seasonal-intern postings). Verified against the live rows — Analyst/Associate
Consultant/Consultant in NY/Chicago/SF are kept; Manager, seasonal, and non-target
metros are dropped.

## ⚠️ Not yet wired — need heavier, per-firm work (3)

### Simon-Kucher — Cornerstone OnDemand (CSOD)
- Careersite: `simon-kucher.csod.com/ux/ats/careersite/6/home?c=simon-kucher`.
- Job data comes from `POST …/services/x/career-site/v1/sites/6/jobs/search`
  (and `…/careersites/6/jobs`), which return **401 "Check your credentials"**
  without the SPA's bearer token. No token in local/session storage — it's fetched
  at runtime. Wiring this means reproducing the token bootstrap, then paging the
  search endpoint.
- Worth it: **85 US roles** (NY 18, Chicago 17, SF 10; "Intern/Associate
  Consultant" is a named function with 30 openings) — the highest US volume of the
  three.

### L.E.K. Consulting — Oracle Talentlink (tal.net)
- Americas board: `lek.tal.net/vx/…/candidate/jobboard/vacancy/3/adv/`.
- Same platform family as **Jefferies** (`jefferies.tal.net`), already flagged as a
  hard/session-based target in `REMAINING_FIRMS.md`. Solve once, reuse for both.

### Strategy& — PwC global careers
- No standalone Strategy& board; openings live inside PwC's careers system and
  would need isolating by brand/business-unit. Messiest of the three; lowest
  confidence on a clean feed.

## Verify after the next live run
The pipeline can't reach the network from inside the Claude workspace, so counts
above are from direct browser calls to each API. Run `python pipeline.py` on a
box with open egress and confirm the four firms report rows (CIL and Mars & Co
should show NY/Chicago immediately; ZS should show several).
