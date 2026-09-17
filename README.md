# Street Watch — self-refreshing job pipeline

Pulls real Analyst/Associate openings from firms' own hiring systems
(Greenhouse + Ashby + Workday), de-dupes, flags what's new, stores them in
Supabase, and serves a live page. Runs itself every morning via GitHub Actions.

```
firms' ATS APIs  ──►  pipeline.py  ──►  Supabase `jobs` table  ──►  index.html (live page)
        (Greenhouse / Ashby / Workday)      (GitHub Actions cron, daily)
```

## Files
| File | What it is |
|------|-----------|
| `pipeline.py` | The ingester. Fetch → filter → dedupe → JSON/CSV + Supabase upsert. |
| `schema.sql` | One-time Supabase `jobs` table + read policy. |
| `schema_applications.sql` | One-time `applications` table (the tracker's store; open anon write). |
| `.github/workflows/street-watch.yml` | Daily cron (11:00 UTC) that runs the pipeline. |
| `dashboard/` | **React + Vite app** — live openings **plus an application tracker** (set Applied/Interview/… per role, saved to Supabase). The primary front-end; see `dashboard/README.md`. |
| `index.html` | Legacy single-file read-only view (no tracker). Kept as a lightweight fallback. |

## Setup (~15 min)

**1. Supabase**
- Create a project → SQL Editor → paste & run `schema.sql`.
- Grab from Project Settings → API: the **Project URL**, the **anon** key
  (public, read-only) and the **service_role** key (secret, write).

**2. GitHub**
- Put these files in a repo.
- Repo → Settings → Secrets and variables → Actions → add:
  - `SUPABASE_URL` = your project URL
  - `SUPABASE_SERVICE_KEY` = the service_role key
- Actions tab → run **Street Watch — daily job pull** once (workflow_dispatch)
  to backfill. It then runs every morning on its own.

**3. Front-end**
- Open `index.html`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top.
- Deploy the file to Vercel / Netlify / GitHub Pages. Done — it shows the live
  list and refreshes as the cron writes new rows.

Test locally first: `pip install requests cloudscraper && python pipeline.py`
(`cloudscraper` is only needed for the Citadel Securities fetcher, which sits
behind Cloudflare; everything else uses plain `requests`.)
(prints the digest; add the two SUPABASE_* env vars to also write to the DB).

## Coverage — the registries in `pipeline.py`

**Live now (Greenhouse):** Jane Street, DRW, IMC, Virtu, Optiver, Sixth Street,
General Atlantic, TPG, Warburg Pincus, iCapital, CAIS, BTIG, StepStone, **KKR**
(token `stage`), **William Blair, EQT, Ducera Partners, LionTree**, PJT*.

**Live now (custom fetchers):** **Citadel Securities** (WordPress admin-ajax via
cloudscraper), **Citi** and **Barclays** (Radancy `search-jobs/results` — one
generic `fetch_radancy` handles both, add more banks to the `RADANCY` dict).
Goldman (`higher.gs`) is scaffolded but its GraphQL is 404ing.

**Green-priority firms (added 2026-09-17, client request):**
- **Carlyle**, **Ardian** — Workday registry entries.
- **Lazard** — Oracle Fusion Recruiting (`recruitingCEJobRequisitions` REST);
  new generic `fetch_oracle` + `ORACLE` dict {host, siteNumber, siteName}. Analyst
  NY/SF + Associate NY live.
- **Oppenheimer & Co.** — HRM Direct; new generic `fetch_hrmdirect` (queries
  `?city=` per target metro). ~26 NY roles.
- **Macquarie Group** — PageUp; new generic `fetch_pageup` (server-rendered
  SearchJobs, paged 9 at a time). ~588 reqs.
- **BNP Paribas** — not wired: Akamai bot gate + custom `/en/search`; needs a
  cloudscraper/browser approach like the Phenom banks.

**Yellow-priority firms, wave 1 (added 2026-09-17, client request):**
- **AllianceBernstein**, **Hamilton Lane**, **Piper Sandler** — Workday entries.
- **Perella Weinberg** — Workday on the shared `myworkdaysite.com` host; new
  generic `fetch_workday_site` + `WORKDAY_SITE` dict {dc, tenant, site}.
- **BlackRock** — Radancy (`RADANCY` dict). **Solomon Partners** — Greenhouse.
  **SIG** — Jibe (`JIBE` dict). **Cantor Fitzgerald** — Oracle (`ORACLE` dict).
- **Stifel** — iCIMS; new generic `fetch_icims` + `ICIMS` dict (server-rendered
  `iCIMS_JobCardItem`s, paged by `pr`). Also covers **KBW** (a Stifel company).
- Can't wire yet: PIMCO / HPS / Qatalyst / Wedbush / Academy / Siebert /
  Rothschild / ANZ (bot gates, email-only, or enterprise ATS) — see
  `REMAINING_FIRMS.md`. The 14 EU/APAC banks are the next pass.

Also note: NY metro matching now uses a standalone-`\bny\b` regex (`_NY_STATE_RE`)
instead of loose `"manhattan"`/`", ny"` substrings — fixes false matches on
"US-KS-Manhattan" and missed "NY, United States".

**Consulting firms (added 2026-09-17, client request):**
- **Mars & Co** and **Altman Solon** — standard Greenhouse boards (`marscousg`,
  `altmansolonuslp`); dropped straight into the `GREENHOUSE` dict.
- **ZS Associates** — Jibe/iCIMS front at `jobs.zs.com/api/jobs` (paginated JSON);
  new generic `fetch_jibe` + `JIBE` dict. ~275 postings.
- **CIL** — Pinpoint ATS at `careers.cil.com/postings.json` (one-shot JSON); new
  generic `fetch_pinpoint` + `PINPOINT` dict. Analyst roles in NY & Chicago.
- **Still to map (heavier, per-firm):** **Simon-Kucher** — Cornerstone/CSOD
  (`simon-kucher.csod.com`, careersite 6; `career-site/v1/.../jobs/search` needs a
  bearer-token bootstrap — 401 without it; 85 US roles incl. NY 18 / Chi 17 / SF 10).
  **L.E.K.** — Oracle Talentlink (`lek.tal.net`, session-based, same family as
  Jefferies). **Strategy&** — no standalone board; roles live inside PwC's global
  careers system and need isolating by brand. See `CONSULTING_FIRMS.md`.

**Wired, will flow once you run it (Workday — 19 firms):** Blackstone, Apollo,
Blue Owl, Ares, Morgan Stanley, Houlihan Lokey, Wells Fargo, Moelis, Brookfield,
Oaktree, Neuberger Berman, Deutsche Bank, Bank of America, PGIM, Invesco,
Wellington, Franklin Templeton, Guggenheim, State Street, Baird. (Tenant/site slugs are
best-effort from public careers URLs — a wrong one just logs an error for that
firm and skips it; fix it from the run output.)

**Still to map (custom / not-yet-found ATS):** JPMorgan (moved to
jpmorganchase.com; Oracle Recruiting backend), Carlyle, Jefferies, Evercore,
Lazard, Centerview, Perella Weinberg, Rothschild, Nomura, RBC/TD/BMO/Scotia/CIBC,
Barclays, HSBC, UBS, BNP, SocGen, SIG, PIMCO, AllianceBernstein, Hamilton Lane,
HPS. (Boutiques checked — none on public Greenhouse; they need per-firm Workday
or custom mapping via the browser.) Drop each into the right registry dict at the top of
`pipeline.py`:
- **Greenhouse:** find the token → `<firm> careers greenhouse.io`
- **Workday:** find `tenant.dcX.myworkdayjobs.com/<site>` → add `(tenant, dc, site)`
- **Ashby:** board name from `jobs.ashbyhq.com/<name>`

\* PJT's Greenhouse token may need re-confirming; Insight Partners (Ashby) board
slug likewise — both are stubbed and fail gracefully until confirmed.

## Notes
- **New-ness** is tracked in `.street_watch_state.json` (committed back by the
  cron) and mirrored to the `is_new` column.
- Workday uses a **POST** endpoint with pagination — already handled. Its list
  payload reports the real `total` only on the first page (0 thereafter), so the
  fetcher captures `total` once and pages against it. The public job URL needs
  the site segment (`host/{site}{externalPath}`) — `host + path` alone 404s.
- **`posted_date`** is the date the firm posted the role: from Greenhouse
  (`first_published`) and Ashby (`publishedAt`). Workday's list payload carries
  no date (a real one would need a per-job detail fetch) and Goldman is
  scaffold-only, so both are `null` — the `index.html` recency filter treats
  those as "unknown" and shows them only under "Any time".
- Titles: market-makers (Jane Street, DRW, IMC…) get a wider keyword set
  (Trader / Quant Researcher / Graduate) so their junior roles aren't missed.
- **Citadel Securities** (`fetch_citadel`) is live via its WordPress admin-ajax
  listing, but that site is behind Cloudflare — so this one fetcher uses
  `cloudscraper` to solve the JS challenge. If cloudscraper is missing or
  Cloudflare escalates to a challenge it can't solve, the fetcher logs and
  returns nothing (the rest of the run is unaffected).
- **Goldman Sachs (`higher.gs`)** is scaffolded (`fetch_goldman`): the search
  posts operation `GetRoles` to `https://higher.gs.com/graphql`. That endpoint
  is currently 404 (GS-side), so the query is best-effort and fails gracefully
  until confirmed — see `pipeline.py` and `TASKS.md`.
