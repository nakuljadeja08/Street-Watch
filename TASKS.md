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

## 🛠 Tech Watch — custom fetchers (added 2026-09-27)

Big data engineering employers not yet in `tech_pipeline.py`. Probed live on
2026-09-27; ordered easiest first. For each one: add the fetcher/registry
entry, run `TECH_NEWSLETTER=0 python tech_pipeline.py`, check the new rows pass
the title/location rules, then update `TECH_FIRMS.md`. A firm's first day never
counts as a hiring spike in Trends, so these can be added any day.

### Quick wins (existing fetchers) — done 2026-09-28
- [x] **Hudson River Trading**: Greenhouse `wehrtyou` in `GREENHOUSE["Finance"]`.
- [x] **Netflix**: Eightfold `explore.jobs.netflix.net` / `netflix.com`, searched
      with `query` (new optional arg on `P.fetch_eightfold`). Titles with `L5`+
      are excluded as senior (L3/L4 kept).
- [x] **Walmart**: Workday moved to `wd504` (`walmart`/wd504/WalmartExternal).
- [x] **Comcast**: Workday `comcast`/wd115/Comcast_Careers.
- [x] **Dell**: left Workday for Oracle Fusion CE (`enterpriseplatform.dell.com`,
      `CX_1001`, site `careers`) — tech `ORACLE` dict.
- [x] **Charles Schwab**: Radancy at `www.schwabjobs.com` — tech `RADANCY` dict.
      Its cards add req-id/"Save for Later" text to the anchor, so
      `fetch_radancy` now takes the title from the card's heading when there is
      one (also fixes Citizens' titles, which had location text appended).
- [ ] **BNY**: careers link redirects to Eightfold `bnymellon.eightfold.ai`, but
      the API 404s for domains `bny.com` / `bnymellon.com` and the page shows
      "domain not found" — capture the real domain from a job page's network tab.
- [ ] **Moody's**: no Workday tenant found under `moodys` on any data center;
      fingerprint careers.moodys.com in the browser.
- [x] **Discover**: skip — its Workday board redirects to a maintenance page
      (Discover is now part of Capital One, already wired).

### Medium (parse the page's embedded data)
- [x] **Google** (2026-09-29): `fetch_google` parses the `ds:1`
      `AF_initDataCallback` blob. A bare "data engineer" search matches ~1,000
      jobs, because it searches descriptions too, so it runs 7 exact-phrase
      queries instead (1–2 pages each). Google rarely uses the DE title: its data
      work is mostly "Software Engineer, …" (excluded). Its "Data Cloud Customer
      Engineer" roles are pre-sales, so `customer|solutions|forward deployed
      engineer` titles are now excluded.
- [ ] **Apple**: `jobs.apple.com/en-us/search?search=data%20engineer&location=united-states-USA`
      embeds its results in `__staticRouterHydrationData`. Parse that JSON and
      page with `&page=N`.
- [x] **Bloomberg** (2026-09-29): `fetch_bloomberg` parses the Avature cards.
      Pages are 12 cards (larger page sizes are ignored), and cards have no
      posted date. Its DE roles are titled "Data Management Professional - Data
      Engineering"; all were Senior on day one.

### Hard (need discovery or anti-bot handling)
- [x] **Microsoft** (2026-09-29): `fetch_microsoft` calls
      `/api/pcsx/search`. It returns 429 unless a session cookie from
      `/careers` is sent first. The old `gcsservices` host is dead. Results are
      relevance-sorted, so paging stops at the first page with no DE title.
- [x] **Meta** (2026-09-29): `fetch_meta`. The anonymous `/jobsearch/` page
      embeds the LSD token, so there's no real handshake. POST `/graphql` with it
      and `CareersJobSearchResultsV2DataQuery` (doc_id in `META_DOC_ID`); one
      call returns every match. If Meta rotates the doc_id, the run logs
      "doc_id stale?" and returns 0; recapture it from the browser network tab.
      "Technical Leadership" titles (Meta's IC6+ track) are now excluded.
- [ ] **Uber**: the old `uber.com/api/loadSearchJobsResults` now 404s. Find the
      current endpoint in the browser's network tab on uber.com/careers.
- [ ] **Two Sigma**: not on Greenhouse. Find its ATS from careers.twosigma.com.
- [ ] **American Express**: not on the Eightfold host tried. Find its ATS from
      aexp.com/careers.
- [ ] **Citadel (hedge fund side)**: likely the same WordPress AJAX pattern as
      `P.fetch_citadel` on citadel.com. Confirm, then parameterize that fetcher.

### After adding fetchers
- [ ] Re-check the 60-day age cap and the level rules against the new sources.
- [ ] Update `TECH_FIRMS.md` group C and the README firm count.

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
- [x] **Goldman Sachs** (`higher.gs`) ✅ live (2026-09-23). The real search
      call is `GetRoles` → `https://api-higher.gs.com/gateway/api/v1/graphql`
      (the old `higher.gs.com/graphql` guess 404s); variables are
      `searchQueryInput{page{pageSize,pageNumber},sort,filters,experiences,searchTerm}`,
      `pageNumber` 0-based. ~918 roles → ~103 after metro/title filters.
- [x] **Citi** + **Barclays** ✅ wired via a generic **`fetch_radancy`** (Radancy
      `/search-jobs/results`, JSON HTML fragment; narrowed by metro keyword). One
      parser handles both card themes; add more banks to the `RADANCY` dict.
      Citi ~113 in-scope, Barclays ~9. Plain requests, no bot gate.
- [ ] Global-bank Workday probe (HSBC, UBS, BNP, SocGen, Nomura, Mizuho, MUFG,
      SMBC, Macquarie, Standard Chartered, Santander, ING, …) → **no hits**; they
      use custom/Avature/Radancy. Next: check each for a Radancy `search-jobs`
      host (cheap), else per-firm browser capture.
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
- [x] **BMO** (Workday bmo.wd3/External), **TD Bank** (td.wd3/TD_Bank_Careers),
      **CIBC** (cibc.wd3/search — unusual slug), **Barclays** + **ING** (Radancy).
      **RBC** = Phenom (`/widgets` batch API — deferred, heavier lift but high
      leverage since many banks use Phenom). **Scotiabank** = SAP SuccessFactors
      (deferred). Still open: HSBC (Avature), UBS, BNP, SocGen, Nomura, and the
      rest of the global banks.
- [x] **US regional banks (Workday, exact slug from careers page):** Capital One
      (capitalone.wd12/Capital_One, 1916), U.S. Bancorp (usbank.wd1/
      US_Bank_Careers, 1381), M&T Bank (mtb.wd5/MTB, 862), Northern Trust
      (ntrs.wd1/northerntrust, 661), KeyBank (keybank.wd5/External_Career_Site,
      614). URLs verified 200.
- [ ] BNY, Fifth Third, Huntington — no ATS fingerprint on careers page; browser.
- [ ] **Phenom cluster (RBC, PNC, Truist, Regions) — deferred, needs browser.**
      Search = Phenom `POST /widgets` batch API; `/api/rest/searchresults` →
      "Tenant not identified" (needs browser-established tenant context, so blind
      requests fail). Sitemap exists but per-job crawl is too heavy. To finish:
      capture the working `/widgets` request in the browser, then build one
      generic Phenom fetcher (unlocks the whole cluster).
- [x] **Age filter:** `age_ok()` drops listings with a known posted_date > 30
      days old (Greenhouse/Ashby); undated sources (Workday/Citi/…) kept.
- [ ] Middle-market: Stifel, Raymond James, Piper Sandler, Oppenheimer, Cantor
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
