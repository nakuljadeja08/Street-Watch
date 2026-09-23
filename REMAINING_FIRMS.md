# Street Watch — Remaining Firms

From `Target_Financial_Firms.xlsx` (121 targets): **67 wired · 54 remaining**
(plus 4 net-new consulting firms wired on request — see `CONSULTING_FIRMS.md`).
Grouped by what we know about each firm's ATS platform. Updated 2026-09-17.

### 🟡 Yellow-priority batch — wave 1 wired 2026-09-17 (9)
Fingerprinted each ATS via a live browser session:
- **BlackRock** → Radancy (existing `fetch_radancy`; ~151 NY hits)
- **AllianceBernstein**, **Hamilton Lane**, **Piper Sandler** → Workday
- **Perella Weinberg Partners** → Workday on `myworkdaysite.com` (new
  `fetch_workday_site` + `WORKDAY_SITE` dict)
- **Solomon Partners** → Greenhouse (`solomonpartnersprofessionals`)
- **Susquehanna International Group (SIG)** → Jibe (existing `fetch_jibe`; 265 reqs)
- **Stifel** → iCIMS (new `fetch_icims`; ~50+ reqs) — also carries **KBW** (a
  Stifel company; no separate board)
- **Cantor Fitzgerald** → Oracle Fusion (existing `fetch_oracle`; 85 reqs)

**Yellow — no public board / can't wire as-is:** PIMCO (Akamai bot gate, ATS not
found) · HPS Investment Partners (renders no listings) · Qatalyst (email-only,
`uscareers@qatalyst.com`) · Wedbush (marketing page + reCAPTCHA form, no board) ·
Academy Securities (email-only) · Siebert Williams Shank (site blocked our access)
· Rothschild & Co (ATS not exposed on landing — needs deeper capture) · ANZ
(`careers.anz.com/go/…`, SuccessFactors/Avature family — needs a dedicated fetcher).

**Yellow — still to fingerprint (14 European/APAC banks):** UBS, HSBC, Crédit
Agricole CIB, Santander CIB, Natixis, BBVA CIB, Intesa Sanpaolo, Standard
Chartered, Lloyds, Commerzbank, DZ BANK, Mizuho, Nomura, Daiwa — the heavy set
(mostly Avature / SuccessFactors / Phenom); next pass.

### 🟢 Green-priority batch wired 2026-09-17 (5 of 6)
Client marked these top priority. Fingerprinted each ATS via a live browser
session and wired all but BNP:
- **Carlyle** → Workday (`carlyle`/wd1/Carlyle, 79 reqs)
- **Ardian** → Workday (`ardian`/wd103/ArdianCareers, 74 reqs)
- **Lazard** → Oracle Fusion Recruiting (new `fetch_oracle`; Analyst NY/SF +
  Associate NY live)
- **Oppenheimer & Co.** → HRM Direct (new `fetch_hrmdirect`; NY 26 / Chi / SF)
- **Macquarie Group** → PageUp (new `fetch_pageup`; ~588 reqs, paged)
- **BNP Paribas** — ⚠️ still open: careers behind an **Akamai bot gate** with a
  custom `/en/search` API; plain `requests` gets challenged. Needs a
  cloudscraper/browser-session approach (same bucket as the Phenom banks).

## ✅ Phenom People — wired 2026-09-18 (new `fetch_phenom`)
Solved: job search is `POST https://<host>/widgets` with `ddoKey:"refineSearch"`.
No cookie/CSRF/tenant handshake needed when the POST targets the firm's own
careers host (tenant is keyed off the Host header) — the "Tenant not identified"
error only hits the generic `/api/apps/*` paths, not `/widgets`. Response nests
jobs under `refineSearch.data.jobs` with `refineSearch.totalHits`; each job has a
real ISO `postedDate` (so the 30-day filter applies). Keyword search doesn't
narrow by location, so we page the whole board and let the metro/title filters
cut it. These tenants front Workday, so `applyUrl` is a myworkdayjobs deep link.
- **RBC Capital Markets** → `jobs.rbc.com` (ca/en_ca) — 1436 raw
- **PNC Financial Services** → `careers.pnc.com` — 2164 raw
- **Truist Securities** → `careers.truist.com` — 1105 raw
- **Regions Securities** → `careers.regions.com` — 529 raw
- **Citizens Financial Group** → actually **Radancy**, not Phenom
  (`jobs.citizensbank.com`, `/search-jobs/`) — added to `RADANCY`, 170 raw

## 🔴 Confirmed other platforms (heavier, per-firm)
- **JPMorgan Chase** — ✅ wired 2026-09-18: Oracle Fusion CE at
  `jpmc.fa.oraclecloud.com` (siteNumber `CX_1001`, siteName `CX_1001`), same
  product as Lazard/Cantor. ~7,400 reqs globally; ~281 kept after filters.
- **Jefferies** — Oracle Talentlink (`jefferies.tal.net`) behind a **Cloudflare
  managed challenge** ("Quick Check Needed"). Same bucket as Citadel — needs a
  cloudscraper session, and vacancies then load via a JS widget. Deferred.
- **Scotiabank** — SAP SuccessFactors
- **Evercore** — board not linked from marketing site (gated/separate)

## ⚪ No fingerprint on careers page — need browser capture
- BNY
- Fifth Third Securities
- Huntington Bancshares

## 🌍 Global / European / APAC banks — not yet investigated
No Workday or Radancy hit under common guesses; likely Avature / SuccessFactors /
custom. Each needs an individual browser capture.
- HSBC *(Avature, likely)* · UBS · BNP Paribas · Société Générale ·
  Crédit Agricole CIB · Natixis · Santander CIB · BBVA CIB · UniCredit ·
  Intesa Sanpaolo · Standard Chartered · Rabobank · Lloyds Bank Corporate Markets ·
  Commerzbank · DZ BANK · Mizuho · MUFG · SMBC Group · Nomura · Daiwa Capital Markets ·
  Macquarie Group · ANZ · Westpac Institutional Bank · DBS Bank · CICC ·
  Bank of China · ICBC · National Bank Financial

## 🏦 Boutiques / advisory — none on public Greenhouse; need per-firm mapping
- Lazard · Centerview Partners · Perella Weinberg Partners · Rothschild & Co ·
  Stifel · Raymond James · Piper Sandler · Oppenheimer & Co. · Canaccord Genuity ·
  Cantor Fitzgerald · Wedbush Securities · Needham & Company · B. Riley Securities ·
  Loop Capital Markets · Siebert Williams Shank · Academy Securities ·
  Allen & Company · Solomon Partners · Qatalyst Partners ·
  Keefe, Bruyette & Woods (KBW) · Susquehanna International Group (SIG)

## 💼 Asset managers / PE — not yet investigated
- BlackRock · Carlyle · Hamilton Lane · Ardian · HPS Investment Partners ·
  PIMCO · AllianceBernstein

---
### 🔧 Wired-but-empty firms fixed 2026-09-18
- **Insight Partners** (Ashby) — slug was `insightpartners` (empty); correct slug
  is `insight-partners` (hyphenated). Now returns roles.
- **Sixth Street** — Greenhouse token `sixthstreet` 404s (dead board). Real ATS is
  Workday `sixthstreet`/wd1/**SixthStreetCareers** (15 reqs). Moved GH → Workday.
- **PJT Partners** — Greenhouse token `pjtpartnersprofessionals` 404s. Real ATS is
  Workday `pjtpartners`/wd1/**Careers** (52 reqs). Moved GH → Workday.
- **Franklin Templeton** — ✅ solved via browser: the old Workday board
  (`franklintempleton`/wd5/`Primary-External-1`) is dead (total=0). Its live
  listings are **Phenom** at `careers.franklintempleton.com` (201 reqs). Moved
  Workday → Phenom; now returns roles.

### ✅ Wired so far
**Greenhouse (17):** Jane Street, DRW, IMC, Virtu, Optiver, General Atlantic, TPG,
Warburg Pincus, iCapital, CAIS, BTIG, StepStone, KKR, William Blair, EQT, Ducera,
LionTree — **Ashby (1):** Insight Partners
**Workday (29):** Blackstone, Apollo, Blue Owl, Ares, Morgan Stanley, Houlihan
Lokey, Wells Fargo, Moelis, Brookfield, Oaktree, Neuberger Berman, Deutsche Bank,
Bank of America, PGIM, Invesco, Wellington, Guggenheim, State Street, Baird, BMO,
TD Bank, CIBC, Northern Trust, Capital One, U.S. Bancorp, KeyBank, M&T Bank,
Sixth Street, PJT Partners
**Radancy (5):** Citi, Barclays, ING, BlackRock, Citizens Financial Group
**Phenom (5):** RBC, PNC, Truist, Regions, Franklin Templeton
**Oracle Fusion CE (3):** Lazard, Cantor Fitzgerald, JPMorgan Chase
**Other (7):** ZS Associates + SIG (Jibe), CIL (Pinpoint), Oppenheimer (HRM Direct),
Macquarie (PageUp), Stifel/KBW (iCIMS), Perella Weinberg (Workday myworkdaysite)
**Custom (2):** Citadel Securities (cloudscraper), Goldman Sachs (higher.gs GraphQL gateway)
