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
