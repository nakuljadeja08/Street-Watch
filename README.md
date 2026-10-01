# Street Watch — self-refreshing job pipeline

Pulls real Analyst/Associate openings from firms' own hiring systems
(Greenhouse + Ashby + Workday), de-dupes, flags what's new, stores them in
Supabase, and serves a live page. Runs itself every morning via GitHub Actions.
At the fintech and fashion firms (`PRODUCT_GTM_FIRMS` in `pipeline.py`) it
pulls Product and go-to-market roles instead: product, sales, partnerships,
marketing and merchandising, with store roles and senior grades left out.
Account Executive roles are dropped everywhere, "Specialist" titles at
fintech firms, and "Manager" titles at fintech and fashion firms (Assistant and Associate
Manager excepted), as all are
senior seats. The auction houses (Christie's, Sotheby's, Phillips,
Bonhams) use the same rule but also keep Analyst, Associate, Cataloguer and
Coordinator titles.

```
firms' ATS APIs  ──►  pipeline.py  ──►  Supabase `jobs` table  ──►  dashboard/ (React app on Vercel)
        (Greenhouse / Ashby / Workday …)   (GitHub Actions cron, daily)
```

## Files
| File | What it is |
|------|-----------|
| `pipeline.py` | The ingester. Fetch → filter → dedupe → JSON/CSV + Supabase upsert. |
| `schema.sql` | One-time Supabase `jobs` table + read policy. |
| `schema_applications.sql` | One-time `applications` table (the tracker's store; open anon write). |
| `.github/workflows/street-watch.yml` | Daily run (external trigger 10:20 UTC + backup crons) that runs the pipeline **and emails the morning newsletter**. |
| `.github/workflows/newsletter-test.yml` | Manual button to re-send the newsletter from the last committed pull (no scrape). |
| `send_test_newsletter.py` | Standalone sender used by the test workflow (and runnable locally). |
| `schema_ai_and_searches.sql` | One-time `saved_searches` table (anon r/w) + the private AI tables (`profile`, `job_details`, `ai_fit`, `ai_drafts` — service key only). |
| `schema_outside_drafts.sql` | Adds a `job` column to `ai_drafts` / `tech_ai_drafts` so cover letters for outside jobs can be listed and reopened. |
| `schema_trends.sql` | One-time `hiring_trends` table (public read) behind the dashboard's **Trends** view. |
| `.street_watch_trends.json` | Running hiring-trends record + yesterday's board (the baseline takedowns are measured against); committed by the daily run. |
| `tech_pipeline.py` | Tech Watch ingester (data engineering roles); see *Tech Watch* below. |
| `schema_tech.sql`, `schema_auth.sql`, `schema_auth_lockdown.sql` | Tech Watch tables; login profiles + signed-in access; removing the old open write access. |
| `schema_tech_custom_jobs.sql` | Tech Watch `tech_custom_jobs` table: roles you applied to off the board (signed-in r/w). |
| `TECH_FIRMS.md` | Tech Watch firm list and which big employers still need custom fetchers. |
| `backfill_trends.py` | One-off: rebuilds the trends history from the daily snapshots in git and pushes it to Supabase. |
| `firm_categories.json` | Firm → type ("PE & Alts", "Bulge Bracket", …). Drives the dashboard's firm-type filter and saved-search alerts; shared by `pipeline.py` and `dashboard/`. |
| `api/` | Vercel serverless routes for the **AI assistant** (resume, fit score, cover letter / "why this firm"). Call Claude server-side; see *AI assistant* below. |
| `dashboard/` | **React + Vite app** — live openings **plus an application tracker** (set Applied/Interview/… per role, saved to Supabase). The front-end, deployed on Vercel from the `release` branch; see `dashboard/README.md`. |

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

**3. Front-end** — the React app in `dashboard/`.
- Run `schema_applications.sql` once (the tracker's store).
- Deploy on Vercel: import the repo — the root `vercel.json` builds `dashboard/`
  and serves `dashboard/dist`, so **no Root Directory change and no env vars are
  needed** (public anon key defaults in `src/config.js`). It reads Supabase live
  and refreshes as the cron writes new rows.
- Run `schema_ai_and_searches.sql` once for saved searches and the AI tables.

## Tech Watch (second board) and login

The site has two boards behind one login: **Street Watch** at `/` (Ms Tian's
finance roles) and **Tech Watch** at `/tech` (Nakul's data engineering
roles). Either account can open both; the bar at the top switches boards and
signs out. Live since 2026-09-27.

```
tech firms' ATS APIs + Street Watch's finance firms  ──►  tech_pipeline.py  ──►  Supabase tech_* tables  ──►  dashboard /tech
                                                          (same daily workflow, `tech` job)
```

### What it pulls
- **Firms:** about 110 tech, fintech and finance boards (Greenhouse, Ashby,
  Lever, Workday, Amazon's jobs API) listed in `TECH_FIRMS.md`, plus every
  Street Watch firm except the consulting shops and fashion houses, searched
  for data roles.
  Google, Meta, Microsoft, Uber, Netflix, Bloomberg, AmEx and Two Sigma need
  custom fetchers and aren't wired yet (task list in `TASKS.md`).
- **Titles in:** Data Engineer (I / II), Analytics Engineer, Data Platform /
  Infrastructure Engineer, ETL and Big Data roles.
- **Titles out:** Senior, Staff, Principal, Lead, Manager and up; level III+
  (and Capital One's numbered level 4+); **any title with "software"**; ML
  engineers; interns; architects, specialists, sales; security (SIEM, data
  protection) and data center roles. Rules: `_DE_RE` / `_DE_EXCLUDE_RE` in
  `tech_pipeline.py`.
- **Where:** US only (including remote US), grouped into hubs: NYC Area, SF Bay
  Area, Seattle, Chicago, Boston, Texas, DC / Virginia, Los Angeles,
  Charlotte, Atlanta, Denver, Remote (US), Other US. Workday's "3 Locations"
  rows are resolved from the job detail.
- **Age:** kept up to **60 days** after posting (data reqs stay open longer
  than banking ones; Street Watch stays at 30).

### Outputs
`tech_watch_jobs.json` / `.csv`, `.tech_watch_state.json` (newness ledger),
`.tech_watch_trends.json`, and the Supabase tables `tech_jobs`,
`tech_hiring_trends`, `tech_applications`, `tech_saved_searches`,
`tech_profile`, `tech_ai_fit`, `tech_ai_drafts` (`schema_tech.sql`).
The morning "Tech Watch" digest goes to the same `NEWSLETTER_TO` as Street
Watch's, from the first run on 2026-09-28. Set `TECH_NEWSLETTER=0` to run a
pull without the email:

```bash
TECH_NEWSLETTER=0 python tech_pipeline.py
```

### The board
`dashboard/src/TechApp.jsx`: a dev-tool layout (sidebar, list, detail pane)
driven by one terminal-style command line. Every filter is a token in it
(`snowflake sector:fintech hub:nyc new status:applied sort:fit age:14`); the
sidebar, saved searches and the URL just write that command. Keys: `/` or ⌘K
search, `j`/`k` move, `o` open posting, `a` mark applied, `f` score fit, `w`
write cover letter. Light and dark themes; Trends reads `tech_hiring_trends`.

**＋ Track outside job** (sidebar, under Tracker) adds a role you applied to
off the board: company, role, link, location, stage and notes. These live in
`tech_custom_jobs` (run `schema_tech_custom_jobs.sql` once), show up in the
list with an `outside` tag, and filter with the `outside` token (*Added by
me*). Clearing the status or *Remove from tracker* deletes one.

### AI
The same `/api` routes, with an `x-watch: tech` header selecting Tech Watch's
own resume, fit scores and drafts. Fit scoring uses a data engineering rubric;
cover letters follow `api/_voice_tech.js`, built from Nakul's own letters
(open on the company's data stakes, map the posting, production proof, name
gaps plainly, why this company). Signed-in users don't need the passphrase.

### Login
Supabase Auth (email + password), one account each. `user_profiles` holds the
display name and home board (`schema_auth.sql`). Sessions persist per browser.
Setup, done 2026-09-27:
1. Run `schema_tech.sql`.
2. Authentication → Users → *Add user* for each person, then run
   `schema_auth.sql` with the two emails filled in (keep real emails out of
   the committed file; this repo is public).
3. `schema_auth_lockdown.sql`: removed the old open (anon) write access to
   Street Watch's tracker tables, so only signed-in users can change them.

Local preview without signing in: `VITE_SKIP_LOGIN=1 npm run dev` in
`dashboard/` (dev builds only; Tech Watch falls back to the last local pull).

## Saved searches

Set filters on the dashboard (level, metro, firm type, keywords) → **☆ Save
search** → name it (e.g. "SF PE Associate"). Each saved search becomes a chip
under the filter bar with a count of roles first seen since you last marked it
seen, and those roles are **pinned** at the top of the list until you hit
*Mark seen*. The morning newsletter also lists each search's new matches above
the full digest (`saved_search_hits` in `pipeline.py`; matching mirrors
`matchesSearch` in `dashboard/src/App.jsx`). Firm types come from
`firm_categories.json` — add new firms there.

## Hiring trends

The dashboard's **Trends** view shows, per day, how many roles were **posted**
and how many were **taken down**, plus net change and roles live. It honors the
metro, firm-type and firm-name filters and has 7d / 30d / all ranges, a
per-firm table (who's hiring, who's pulling roles) and the daily numbers.

After each pull `update_trends()` in `pipeline.py` compares today's board with
the board at the end of the previous day and writes one row per (day, firm,
metro) to Supabase `hiring_trends` (history also kept in
`.street_watch_trends.json`). What counts:

- **Posted**: first seen today. A firm's first day in the pipeline doesn't
  count, so wiring up a new firm isn't read as a hiring spike.
- **Taken down**: on yesterday's board and gone from the firm's own feed today.
  A role still listed that we now filter out (a new title rule, past the 30-day
  age cap) leaves the board without counting.
- A firm whose feed fails (0 rows) is carried forward, not counted as taken down.
- Same-day re-runs (backup crons, manual runs) recompute the day instead of
  double counting. A missed day rolls into the next day's numbers.

Setup: run `schema_trends.sql` once, then `python backfill_trends.py` with the
two `SUPABASE_*` env vars set to load history from the git snapshots (starts
2026-09-18; earlier days were pipeline build-out churn).

## AI assistant (fit score + cover letters)

The dashboard's **✨ AI** button opens a panel where you connect with a
passphrase and upload your resume (PDF or text; a PDF is transcribed once by
Claude). Then each card gets:

- **✨ Fit** — Claude reads the job posting and your resume and returns a 0–100
  score with a one-line reason (shown on the card; sort by **Best fit**;
  **✨ Score next 5** scores the next unscored roles in the list).
- **✍ Write** — a first-draft cover letter and a "Why <firm>?" answer, written
  to the rules of the `job-application-answers` skill (voice, structure, strict
  no-dashes) plus the candidate's own narration pattern and story bank (open on
  a real scene, one line pivot, firsthand proof, why this firm, humble close;
  see `api/_voice.js` to edit them). Claude web-searches the firm
  first (cached per firm for 14 days), uses your card notes, and may ask one
  follow-up question — answer it in the modal and hit *Regenerate with this*.
- **✍ Outside job** — a cover letter for a role that isn't on the board (AI
  panel or Board view on Street Watch, sidebar on Tech Watch). Enter the
  company, role and pasted job description; it drafts the same way. These use
  job ids starting `x_`, keep the posting in `job_details`, and are listed under
  *Earlier outside drafts* to reopen or delete (needs `schema_outside_drafts.sql`).

Job descriptions are fetched from each firm's own ATS (Workday/Greenhouse/Ashby/
Oracle/Goldman APIs, else the page's JobPosting JSON-LD) and cached in
`job_details`. When a site blocks that (Citadel's Cloudflare, a few others) the
app asks you to paste the description once.

The routes in `api/` run on Vercel and use `claude-sonnet-5`. Your resume, the
drafts and the scores sit in Supabase tables that only the service key can
read; the routes are gated by a passphrase so nobody else can use your API
credits. **Vercel → Project → Settings → Environment Variables:**

| Var | Notes |
|-----|-------|
| `ANTHROPIC_API_KEY` | Claude API key (console.anthropic.com) |
| `SUPABASE_SERVICE_KEY` | the service_role key (same as the GitHub secret) |
| `STREET_WATCH_KEY` | any passphrase you choose; type it into the ✨ AI panel once per browser |

Rough cost: ~1¢ per fit score, ~3¢ per draft. Locally, put the same three vars
in the root `.env`; `npm run dev` in `dashboard/` serves `api/` too.

## Deployment rule — Vercel deploys from `release` only
`main` is for development (and the daily bot's data commits); **it is never
deployed**. Vercel's Production Branch is **`release`**, and `vercel.json` sets
`git.deploymentEnabled.main = false`, so a push to `main` never triggers a build
even by accident. The deployed dashboard reads Supabase live, so it always shows
the latest pull regardless of when `release` last built.

**To publish the current `main` to the live site:**
```bash
git checkout release && git merge main && git push && git checkout main
```
Then Vercel builds `release` and the site updates.

Test locally first: `pip install requests cloudscraper && python pipeline.py`
(`cloudscraper` is only needed for the Citadel Securities fetcher, which sits
behind Cloudflare; everything else uses plain `requests`.)
(prints the digest; add the two SUPABASE_* env vars to also write to the DB).

## Morning newsletter (SMTP)

After each daily pull, `pipeline.py` emails a digest of that morning's **new**
roles — a teaser (dashboard-themed: soft pink/cream + Fraunces serif, a
lipstick-red "new today" stat, a forest-green button) whose job is to pull the
reader back to the live board. It opens with a *Good morning, Ms Tian* greeting
and sends in **both** cases: a list of the new roles, or a short "nothing
overnight" note on a quiet day.

Below the roles, a **hiring pulse** block summarises the last 7 days from the
trends data: roles posted / taken down / net, today's pull, and the three firms
growing and pulling back the most, linking to the dashboard's Trends view
(`trend_summary` in `pipeline.py`; left out until there's trend history).

The send is **opt-in and non-fatal**: if the SMTP env isn't set it skips
silently, and any send error is logged but never fails the run.

**Env vars** (set as GitHub **secrets** unless noted; the daily workflow wires
them in):

| Var | Required | Notes |
|-----|----------|-------|
| `SMTP_HOST` | yes | e.g. `smtp.gmail.com` |
| `SMTP_USER` | yes | login / default From address |
| `SMTP_PASSWORD` | yes | **Gmail App Password**, not the account password |
| `NEWSLETTER_TO` | yes | recipient(s), comma/semicolon-separated |
| `DASHBOARD_URL` | yes | the CTA button target (the live Vercel URL) |
| `SMTP_PORT` | no | `587` STARTTLS (default) or `465` SSL |
| `NEWSLETTER_FROM` | no | overrides the From header (defaults to `SMTP_USER`) |
| `NEWSLETTER_SEND_EMPTY` | no | `1` to send the greeting even on zero-new days; the daily workflow sets this |
| `NEWSLETTER_FORCE` | no | `1` to re-send even if today's newsletter already went out (normally one per UTC day) |

**Gmail setup:** enable 2-Step Verification → create an App Password (Google
Account → Security → App passwords) → use it as `SMTP_PASSWORD`.

**Test it anytime:** Actions tab → **Street Watch — test newsletter** →
*Run workflow*. It re-sends from the last committed `street_watch_jobs.json`
(forces a send even if nothing is new) without scraping or touching data. Or
locally: set the env vars and `python send_test_newsletter.py`.

### Reliable daily trigger

GitHub's `schedule:` is best-effort. For this repo every cron time we tried
(11:00, 10:20, 12:47 UTC) started **4–5 hours late** (≈11am ET) and on some days
not at all, so the
newsletter missed its 9am target. The fix is an external scheduler that calls
the workflow's `workflow_dispatch` endpoint on time; the GitHub crons stay as
backups. `pipeline.py` records the send date in `.street_watch_state.json`
(`__newsletter_sent__`) and mails **at most once per UTC day**, so backup or
manual runs only refresh data.

Setup (once):

1. GitHub → Settings → Developer settings → **Fine-grained token** → repo
   `Street-Watch` only → permission **Actions: Read and write**.
2. [cron-job.org](https://cron-job.org) (free) → new cron job:
   - URL `https://api.github.com/repos/nakuljadeja08/Street-Watch/actions/workflows/street-watch.yml/dispatches`
   - Method **POST**, schedule daily **10:00 UTC** (timezone UTC)
   - Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     `Content-Type: application/json`
   - Body: `{"ref":"main"}` — success is HTTP **204**.
3. Set a reminder to rotate the token before it expires.

## Coverage — the registries in `pipeline.py`

**Live now (Greenhouse):** Jane Street, DRW, IMC, Virtu, Optiver, Sixth Street,
General Atlantic, TPG, Warburg Pincus, iCapital, CAIS, BTIG, StepStone, **KKR**
(token `stage`), **William Blair, EQT, Ducera Partners, LionTree**, PJT*.

**Live now (custom fetchers):** **Citadel Securities** (WordPress admin-ajax via
cloudscraper), **Citi** and **Barclays** (Radancy `search-jobs/results` — one
generic `fetch_radancy` handles both, add more banks to the `RADANCY` dict).
**Goldman Sachs** (`higher.gs` GraphQL gateway) is live too.

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
Barclays, UBS, BNP, SocGen, SIG, PIMCO, AllianceBernstein, Hamilton Lane,
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
  no date (a real one would need a per-job detail fetch) and Goldman's search
  API exposes none, so both are `null` — the `index.html` recency filter treats
  those as "unknown" and shows them only under "Any time".
- Titles: market-makers (Jane Street, DRW, IMC…) get a wider keyword set
  (Trader / Quant Researcher / Graduate) so their junior roles aren't missed.
- **Citadel Securities** (`fetch_citadel`) is live via its WordPress admin-ajax
  listing, but that site is behind Cloudflare — so this one fetcher uses
  `cloudscraper` to solve the JS challenge. If cloudscraper is missing or
  Cloudflare escalates to a challenge it can't solve, the fetcher logs and
  returns nothing (the rest of the run is unaffected).
- **Goldman Sachs (`higher.gs`)** is live (`fetch_goldman`): the search posts
  operation `GetRoles` to `https://api-higher.gs.com/gateway/api/v1/graphql`
  (not `higher.gs.com/graphql`, which 404s). `pageNumber` is **0-based** and
  `pageSize` must be < 500.
