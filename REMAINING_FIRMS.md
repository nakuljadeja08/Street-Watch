# Street Watch — Remaining Firms

From `Target_Financial_Firms.xlsx` (121 targets): **53 wired · 68 remaining.**
Grouped by what we know about each firm's ATS platform. Updated 2026-09-17.

## 🟡 Phenom People — one generic fetcher unlocks all of these
Search runs through Phenom's `POST /widgets` batch API. `/api/rest/searchresults`
returns "Tenant not identified" — the API needs tenant context set by a real
browser page load, so blind `requests` fail. **Blocked only on browser access.**
- RBC Capital Markets
- PNC Financial Services
- Truist Securities
- Regions Securities
- Citizens Financial Group *(likely Phenom — confirm)*

## 🔴 Confirmed other platforms (heavier, per-firm)
- **JPMorgan Chase** — Oracle Recruiting backend (moved to jpmorganchase.com)
- **Jefferies** — Oracle Talentlink (`jefferies.tal.net`)
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
### ✅ Wired so far (53)
**Greenhouse (19):** Jane Street, DRW, IMC, Virtu, Optiver, Sixth Street, General
Atlantic, TPG, Warburg Pincus, iCapital, CAIS, BTIG, StepStone, KKR, William Blair,
EQT, Ducera, LionTree, PJT* — *Ashby (1):* Insight Partners*
**Workday (28):** Blackstone, Apollo, Blue Owl, Ares, Morgan Stanley, Houlihan
Lokey, Wells Fargo, Moelis, Brookfield, Oaktree, Neuberger Berman, Deutsche Bank,
Bank of America, PGIM, Invesco, Wellington, Franklin Templeton, Guggenheim, State
Street, Baird, BMO, TD Bank, CIBC, Northern Trust, Capital One, U.S. Bancorp,
KeyBank, M&T Bank
**Radancy (3):** Citi, Barclays, ING — **Custom (2):** Citadel Securities
(cloudscraper), Goldman Sachs (scaffold, /graphql 404ing)

\* wired but not currently returning data (no live public board found).
