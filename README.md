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
| `schema.sql` | One-time Supabase table + read policy. |
| `.github/workflows/street-watch.yml` | Daily cron (11:00 UTC) that runs the pipeline. |
| `index.html` | Live front-end that reads Supabase. Host on Vercel/Netlify/Pages. |

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

Test locally first: `pip install requests && python pipeline.py`
(prints the digest; add the two SUPABASE_* env vars to also write to the DB).

## Coverage — the registries in `pipeline.py`

**Live now (Greenhouse):** Jane Street, DRW, IMC, Virtu, Optiver, Sixth Street,
General Atlantic, TPG, Warburg Pincus, iCapital, CAIS, BTIG, StepStone, PJT*.

**Wired, will flow once you run it (Workday — 19 firms):** Blackstone, Apollo,
Blue Owl, Ares, Morgan Stanley, Houlihan Lokey, Wells Fargo, Moelis, Brookfield,
Oaktree, Neuberger Berman, Deutsche Bank, Bank of America, PGIM, Invesco,
Wellington, Franklin Templeton, Guggenheim, State Street. (Tenant/site slugs are
best-effort from public careers URLs — a wrong one just logs an error for that
firm and skips it; fix it from the run output.)

**Still to map (custom / not-yet-found ATS):** KKR, Carlyle, JPMorgan, Citi,
Goldman Sachs (`higher.gs`), Jefferies, Evercore, Lazard, Centerview, Perella
Weinberg, Rothschild, Nomura, RBC/TD/BMO/Scotia/CIBC, Barclays, HSBC, UBS, BNP,
SocGen, Citadel Securities, SIG, PIMCO, AllianceBernstein, Hamilton Lane,
StepStone, HPS. Drop each into the right registry dict at the top of
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
- **Goldman Sachs (`higher.gs`)** is scaffolded (`fetch_goldman`): the search
  posts operation `GetRoles` to `https://higher.gs.com/graphql`. That endpoint
  is currently 404 (GS-side), so the query is best-effort and fails gracefully
  until confirmed — see `pipeline.py` and `TASKS.md`.
