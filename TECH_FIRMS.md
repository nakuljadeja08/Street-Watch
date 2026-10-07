# Tech Watch — draft firm list (for review)

Target: **data engineering, 0–4 yrs, anywhere in the US (incl. remote-US)**.
Titles in: Data Engineer (I/II), Analytics Engineer, Data Platform / Data
Infrastructure Engineer, ETL / Big Data / Data Warehouse Engineer, "Software
Engineer, Data". Titles out: Senior / Staff / Principal / Lead / Manager /
Director / VP, ML Engineer, interns.

Probed live on 2026-09-27. "DE now" = matching US roles on the board today
(rough count; the real filter will be tuned). A board with 0 today is still
worth wiring: it costs one API call a day and roles come and go.

## A. Board works, has matching roles today

| Firm | Sector | ATS | DE now |
|------|--------|-----|-------:|
| Capital One | Finance | Workday (already wired) | many |
| Anthropic | AI | Greenhouse | 5 |
| OpenAI | AI | Ashby | 3 |
| Point72 | Finance (hedge fund) | Greenhouse | 3 |
| TD Bank | Finance | Workday (already wired) | 2+ |
| State Street | Finance | Workday (already wired) | 1+ |
| Northern Trust | Finance | Workday | 2 |
| DoorDash | Tech | Greenhouse | 2 |
| Sigma Computing | Data tooling | Greenhouse | 2 |
| Samsara | Tech | Greenhouse | 1 |
| Jane Street | Finance (trading) | Greenhouse (already wired) | 2 |
| DRW | Finance (trading) | Greenhouse (already wired) | 2 |
| IMC Trading | Finance (trading) | Greenhouse (already wired) | 2 |
| Jump Trading | Finance (trading) | Greenhouse | 2 |
| Akuna Capital | Finance (trading) | Greenhouse | 1 |
| Mizuho | Finance | Workday (already wired) | 2 |
| CIBC | Finance | Workday (already wired) | 1 |
| Carlyle | Finance (PE) | Workday (already wired) | 1 |
| Hamilton Lane | Finance (PE) | Workday (already wired) | 1 |
| Bank of America | Finance | Workday (already wired) | 1+ |
| U.S. Bancorp | Finance | Workday (already wired) | 1 |
| Figma | Tech | Greenhouse | 1 |
| Brex | Fintech | Greenhouse | 1 |
| Disney | Tech / media | Workday | 1 |
| Modal | Data / AI infra | Ashby | 1 |
| Benchling | Tech | Ashby | 1 |

## B. Board works, no matching role today (wire for coverage)

**Tech:** Airbnb, Lyft, Pinterest, Reddit, Dropbox, Twilio, Cloudflare,
Datadog, MongoDB, Elastic, Okta, Databricks, Snowflake, Fivetran, Starburst,
Scale AI, Asana, Discord, Roblox, Duolingo, Flexport, Vercel, GitLab, Waymo,
Nuro, Lucid Motors, Tripadvisor, Squarespace, Peloton, Notion, Linear, Vanta,
Cursor, Perplexity, Replit, Supabase, Instacart, Palantir, Spotify, NVIDIA,
Salesforce, Adobe, Intel, Cisco, HP, Autodesk, CrowdStrike, Workday, Zoom, Snap,
Target.

**Fintech:** Stripe, Robinhood, Coinbase, Affirm, SoFi, Chime, Mercury, Ramp,
Plaid, Toast, Carta, Addepar, Gemini, Ripple, Kraken, Block, Gusto, Betterment,
Wealthfront, PayPal, Visa, Mastercard, Synchrony.

**Finance:** every Street Watch firm (≈90, already wired — just a different
title filter), plus Fidelity, T. Rowe Price, Nasdaq, S&P Global, Morningstar,
Tower Research, Schonfeld, Virtu.

## C. Big DE employers that need a custom fetcher (ask: which are worth it?)

Google, Meta, Microsoft, Apple, Uber, Netflix, Walmart, Bloomberg, American
Express, Two Sigma, Citadel (hedge fund side), Hudson River Trading, Charles
Schwab, BNY, Moody's, Discover, Comcast, Dell. JPMorgan, Goldman and Citi are
already covered by Street Watch fetchers.

My suggestion: wire all of A and B now, and add custom fetchers for Google,
Meta, Microsoft, Uber, Netflix, Bloomberg, AmEx and Two Sigma in a second pass,
since those post the most data roles.

## Changes after launch

- **2026-09-28**: Amazon removed at the user's request. Its feed dominated the
  board (32 of 65 roles). Added from section C: Hudson River Trading
  (Greenhouse), Netflix (Eightfold), Walmart and Comcast (Workday), Dell (Oracle
  Fusion) and Charles Schwab (Radancy). BNY and Moody's are still open (see
  TASKS.md).
- **2026-09-29, Wave 2**: 106 firms added. Every board below answered its
  public API that day; most had no matching role yet and are wired for coverage.
  - *Had matching roles when probed:* SpaceX, Bridgewater, Zoox, Gopuff, Clear
    Street, Socure, Sardine, NerdWallet, Cohere, Klaviyo, Oscar Health, Chewy,
    Equifax.
  - *Trading / hedge funds:* AQR, Man Group, Squarepoint, WorldQuant, Old
    Mission, Chicago Trading Co, Geneva Trading, Belvedere, Voleon, ExodusPoint.
  - *Finance / market infrastructure (Workday):* Vanguard, Raymond James, LPL,
    Prudential, Allstate, CME Group, Cboe, FactSet, Broadridge, TransUnion;
    payments (Fintech): Fiserv, FIS, Global Payments.
  - *Fintech:* Nubank, Upstart, Bill.com, Adyen, Payoneer, Circle, Paxos,
    Fireblocks, Alloy, Mission Lane, Earnin, Acorns.
  - *Data tooling:* Confluent, ClickHouse, Hex, Astronomer, Airbyte, Monte
    Carlo, Dataiku, Collibra, Mixpanel, Amplitude, Grafana Labs.
  - *Tech:* Zillow, eBay, Expedia, Red Hat, Nike, Warner Bros. Discovery, Glean,
    Harvey, Verkada, Motive, Rubrik, Wiz, Braze, Faire, Celonis, and 36 smaller
    Greenhouse/Ashby/Lever boards (see `tech_pipeline.py`).
  - *Not added (outside tech/finance scope, pending a decision):* Travelers, GM,
    Boeing, Humana, Home Depot, Cigna, CVS, Elevance.
  - *Need custom fetchers:* Two Sigma, D. E. Shaw, Millennium, Citadel (fund),
    Balyasny, Five Rings, XTX, MSCI, ICE, DTCC, Intuit, ServiceNow, Palo Alto
    Networks, Atlassian, Shopify, HubSpot, Rippling, dbt Labs, Anduril,
    Marqeta, Revolut, Klarna.
- **2026-09-30, data-infra title rule**: titles containing "software" are still
  excluded in general, but at data-infrastructure companies (`DATA_INFRA` in
  `tech_pipeline.py`: Databricks, Snowflake, Confluent, ClickHouse, Fivetran,
  Starburst, Airbyte, Astronomer, Monte Carlo, MongoDB, Elastic, Cockroach Labs,
  Sigma Computing, Hex, Dataiku, Collibra) a "Software Engineer/Developer" title
  that names a data area (data, database, pipelines, streaming, warehouse,
  ingestion, ETL, Spark, Kafka, Flink) passes. Seniority, intern and pre-sales
  exclusions still apply. It matched 4 roles on day one, none of them both in
  the US and under 60 days old.

### 2026-10-05: staffing agencies (sector "Agency")
Big employers fill many contract and contract-to-hire data roles through
agencies, posted only on the agency's own board. Searched nationwide for
"data engineer"; the usual title and US filters apply, and each title is tagged
Contract / Contract-to-hire / Direct hire.

| Agency | Board | DE roles at launch |
|---|---|---:|
| Robert Half | roberthalf.com `/jobs/all/data-engineer` | 32 |
| Motion Recruitment (incl. Jobspring) | data-engineering specialty page (20 newest) | 8 |
| TEKsystems (Allegis tech brand) | Phenom, keyword search | 7 |
| Randstad | randstadusa.com, relevance-sorted; stops at first page with no DE title | 5 |
| Blue Signal | Loxo-hosted board | 1 |
| Michael Page | michaelpage.com `/jobs/data-engineer` | 0 |
| Harvey Nash | careers.harveynashusa.com (whole board, one page) | 0 |

Not added: Hays US (search pages 404), Atrium, Adecco, Goodwin, Alexander
Chapman (UK), BW Global USA (no job board; generic "training" site).

### 2026-10-07: oil & gas (sector "Energy")
Added at Nakul's request — he has prior energy-sector experience, so these are
worth applying to. Same "data engineer" Workday search and the usual title / US
filters. All nine boards were confirmed live that day (`WORKDAY["Energy"]` in
`tech_pipeline.py`); none had a US junior DE role on day one, wired for coverage.

| Firm | Workday board (tenant/dc/site) | Board total |
|---|---|---:|
| Chevron | chevron / wd5 / jobs | 61 |
| Baker Hughes | bakerhughes / wd5 / BakerHughes | 231 |
| Williams | williams / wd5 / External | 74 |
| Devon Energy | devonenergy / wd5 / Careers | 43 |
| Marathon Petroleum | mpc / wd1 / MPCCareers | 40 |
| Enbridge | enbridge / wd3 / enbridge_careers | 30 |
| ConocoPhillips | conocophillips / wd1 / external | 25 |
| ONEOK | oneok / wd1 / ONEOK | 24 |
| Occidental (Oxy) | oxy / wd5 / corporate | 17 |

Not added: ExxonMobil and Phillips 66 (SAP SuccessFactors — no fetcher); Valero,
Halliburton, SLB, Kinder Morgan, Targa, Coterra, Cheniere, EOG, Enterprise
Products, Dominion, NextEra (not on Workday / ATS we don't fetch). Enbridge is
Canada-HQ but has large US operations; the US location filter keeps only US roles.
