# Street Watch — Tasks

Status of the job-tracker build. Checked = done, unchecked = remaining.
Last updated: 2026-09-15

> **Pipeline debug pass (2026-09-15):** fixed a Workday pagination bug that
> silently truncated most firms to 40 jobs (Workday reports `total` only on the
> first page → capped at 2 pages; now captures full feeds, e.g. Blackstone
> 40→178, Wells Fargo →1781). Fixed a Workday **URL** bug — links were built as
> `host + externalPath`, missing the site segment, so every Workday job URL
> 404'd; now `host/{site}{externalPath}` (verified 200). A re-run repairs the
> broken URLs already in the DB (upsert merges on `id`). Fixed CSV to write UTF-8 (was crashing on
> non-cp1252 titles on Windows). Made `push_supabase` resilient (logs instead of
> crashing the run on a network error). Diagnosed the "getaddrinfo failed"
> traceback: `SUPABASE_URL` was missing the trailing `f` — correct host is
> `https://lspdfpveonvxwjxrdrpf.supabase.co`. Verified the Supabase write path
> end-to-end (insert/read/delete of a probe row succeeded). Added StepStone
> (Greenhouse) to the registry. Scaffolded a Goldman Sachs (higher.gs) fetcher.
> Confirmed Ashby URLs are correct (`jobUrl` → jobs.ashbyhq.com, 200 — no fix
> needed). Added a `posted_date` column (Greenhouse/Ashby populate it; Workday &
> Goldman null). Wired the `index.html` recency filter. **Ran the pipeline
> end-to-end: 459 rows now live in Supabase**, Workday URLs fixed, posted dates
> populated.

---

## ✅ Done
- [x] Dashboard artifact (Street Watch) — live openings + firm-search grid + metro/recency filters
- [x] Excel application tracker, pre-loaded with 34 live roles (`Street_Watch_Application_Tracker.xlsx`)
- [x] Daily morning alert (scheduled task) — pushes new Analyst/Associate roles to phone
- [x] Pipeline built: Greenhouse + Ashby + Workday fetchers, filter, dedupe, "new" flag, Supabase upsert
- [x] 33 firms wired into the pipeline registries (13 Greenhouse, 19 Workday, 1 Ashby)
- [x] `index.html` frontend wired with the project URL + anon key
- [x] Files placed on Desktop\street-watch

---

## 🚀 Deploy (do these to go live) — YOUR credentials required
- [x] **1. Create the DB table** — done & verified (table exists, RLS read works,
      service-key write works).
- [x] **2. Get the service_role key** — obtained.
- [x] **3. Populate the DB** — done 2026-09-15: **459 rows** upserted (NY 370 ·
      Chicago 65 · SF 24; Workday 358 · Greenhouse 101), no errors. Workday URLs
      verified 200; `posted_date` populated for all Greenhouse rows. Re-run any
      time with:
      ```powershell
      cd $HOME\Desktop\street-watch
      $env:SUPABASE_URL="https://lspdfpveonvxwjxrdrpf.supabase.co"
      $env:SUPABASE_SERVICE_KEY="<service_role key>"
      python pipeline.py
      ```
- [ ] **4. View it** — double-click `index.html` (reads Supabase directly), or deploy the folder to Vercel / Netlify / GitHub Pages for a shareable URL
- [ ] **5. Automate the daily refresh** — push the folder to a GitHub repo, add repo secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, enable Actions. The workflow (`.github/workflows/street-watch.yml`) runs every morning.
- [ ] Keep `service_role` key secret — env var / GitHub secret only, NEVER in `index.html` or committed to git.

---

## 🔧 Fix & validate (from the first run's output)
- [ ] Check the pipeline digest for firms that errored — a wrong Workday `(tenant, dc, site)` just skips that firm. Send me the errors and I'll correct the slugs in `pipeline.py`.
- [ ] Confirm **PJT Partners** Greenhouse token — checked `pjtpartners`, `pjt`,
      `pjtcareers`, `pjtpartnersprofessionals`: all 404. No public Greenhouse
      board found; likely a custom/non-public ATS. Stays gracefully stubbed.
- [ ] Confirm **Insight Partners** Ashby board slug — checked `insight`,
      `insightpartners`, `insight-partners`, `insightpartnerscareers`,
      `insightpartnersllc`: all 404. Slug not found; stays stubbed.
- [x] **StepStone** wired via Greenhouse token `stepstone` (confirmed live, 70
      postings, ~9 in-scope after filter).
- [ ] Verify **Hamilton Lane** Workday site slug (`hamiltonlane.wd108` — site not yet confirmed)

---

## 📈 Expand coverage — remaining firms need per-firm ATS mapping
Custom career portals (no standard public API — each needs its own fetcher):
- [~] Goldman Sachs (`higher.gs`) — **scaffolded** in `pipeline.py`
      (`fetch_goldman`, wired into `collect()`). Reverse-engineered: Next.js +
      Apollo app; results page POSTs operation `GetRoles` to
      `https://higher.gs.com/graphql`; role shape confirmed
      (roleId/jobTitle/corporateTitle/locations/status); public URL
      `https://higher.gs.com/roles/<numeric-id>`. **Blocker:** `/graphql`
      currently returns 404 for everyone (GS's own site call 404s too), so the
      exact `GetRoles` query text/variables couldn't be confirmed — the query in
      the scaffold is best-effort. When the endpoint responds 200, copy the real
      request payload (DevTools → Network → POST /graphql) into
      `GS_GETROLES_QUERY`/`variables`. Fails gracefully until then.
- [x] **Citi** ✅ wired (`fetch_citi`). `jobs.citi.com` Radancy results endpoint
      (`/search-jobs/results`, JSON with an HTML card fragment); narrowed by metro
      keyword, parsed for title/location/URL. Plain requests work (no bot gate).
      Verified 1125 raw → 111 in-scope (NY 100, SF 9, Chicago 2).
- [ ] JPMorgan Chase — careers moved to jpmorganchase.com (AEM marketing home);
      job search now sits on an Oracle Recruiting backend. Needs deeper browser
      capture of the Oracle/Phenom search API. Deferred.
- [x] **Baird** ✅ wired (Workday `baird.wd1/Careers`, 113 jobs) — found via a
      tenant probe.
- [ ] Boutiques still unmapped — none on public Greenhouse. Workday tenant probe
      (Evercore, Lazard, Carlyle, Nomura, Barclays, HSBC, UBS, Macquarie,
      Rothschild, Perella, Centerview, Stifel, Raymond James, Piper Sandler,
      PIMCO, AllianceBernstein, Hamilton Lane, HPS) found no hits under common
      tenant/dc/site guesses. Known platforms: **Jefferies** → Oracle Talentlink
      (`jefferies.tal.net`); **Evercore** → board not linked from marketing site.
      Each needs individual browser capture of its real ATS.
- [ ] Jefferies, Evercore, Lazard, Centerview, Perella Weinberg, Rothschild
- [x] **Citadel Securities** ✅ wired (`fetch_citadel`). Their WordPress careers
      site loads via admin-ajax (`action=careers_listing_filter`,
      `selected-job-sections=323,325,324,326`) returning JSON with an HTML
      fragment of cards. It's behind Cloudflare, so the fetcher uses
      `cloudscraper` (added to the workflow's pip install) to solve the JS
      challenge — verified 84 jobs → 12 in-scope NY roles. Fails gracefully if
      cloudscraper is missing or Cloudflare escalates.
- [ ] Susquehanna (SIG)
- [x] **KKR** ✅ wired — its careers page embeds a Greenhouse board under token
      `stage` (found via the iframe `for=stage`; `kkr` itself 404s). 139 jobs,
      ~36 US-metro. Confirmed company "Careers at KKR".
- [ ] Carlyle, HPS  (StepStone ✅ live)

**New firms wired this pass (from `Target_Financial_Firms.xlsx`, all Greenhouse):**
- [x] William Blair (`williamblair`, 51) · EQT (`eqtpartners`, 25) ·
      Ducera Partners (`ducerapartners`, 7) · LionTree (`liontree`, 1).
- Note: bulk-probing the remaining ~40 unwired firms was unreliable in the
  sandbox (network resets caused false negatives), so absence of a hit there is
  NOT proof a firm lacks a public board — re-probe from a stable network.
- [ ] PIMCO, AllianceBernstein
- [ ] Remaining banks: Barclays, HSBC, UBS, BNP Paribas, SocGen, Nomura, RBC, TD, BMO, Scotiabank, CIBC
- [ ] Middle-market: Stifel, Raymond James, Piper Sandler, William Blair, Baird, Oppenheimer, Cantor
> Priority order (highest hiring volume first): **Goldman, Citi, Citadel Securities, KKR, JPMorgan.**

---

## 💡 Nice-to-haves (later)
- [ ] SF / Bay Area coverage is thin — the API-covered firms skew NY/Chicago; the custom-portal work above fixes this
- [x] Add a `posted_date` column — **done in code + schema.** Sources: Greenhouse
      `first_published`, Ashby `publishedAt` (both populate 100%); Workday's list
      payload has no date so it's null (a real date would need a per-job detail
      fetch); Goldman scaffold null. ⚠️ **Run this once before the next pipeline
      run** (the existing table lacks the column — upserts 400 until then):
      ```sql
      alter table public.jobs add column if not exists posted_date date;
      ```
- [x] Frontend recency filter wired in `index.html` — an "Any time / 24h / 7d /
      30d" toggle that filters on `posted_date`, shows a relative posted age on
      each card, and reports how many rows are hidden for having no posted date
      (Workday/Goldman). Day-granular (posted_date is a DATE), so buckets are
      days, not literal hours.
- [ ] Point the daily phone alert at the Supabase table (single source of truth) instead of re-searching
- [x] **Application tracker** — built as `dashboard/` (React + Vite). Per-role
      status (interested/applied/interview/offer/rejected) persisted to a new
      Supabase `applications` table (`schema_applications.sql`, open anon write).
      Supersedes the "hide roles already in the Excel tracker" idea — status now
      lives in Supabase, filterable in the dashboard. ⚠️ **Run
      `schema_applications.sql` once** before using the tracker.
- [ ] Widen title keywords / add function tags (IB, S&T, PE, Research) for finer filtering
