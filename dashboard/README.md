# Street Watch — Dashboard (React + Vite)

Live openings **plus a built-in application tracker**. Reads the Supabase `jobs`
table and reads/writes an `applications` table so you can set a status
(Interested / Applied / Interview / Offer / Rejected) on any role and have it
persist. Replaces the old single-file `index.html`.

## One-time Supabase setup
Run **`../schema_applications.sql`** in the Supabase SQL editor once. It creates
the `applications` table with **open anon read+write** (personal-tracker mode —
anyone with your URL + anon key can edit; fine for a private link, switch to
Supabase Auth before sharing publicly).

## Run locally
```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173
```

## Build & deploy
```bash
npm run build      # outputs dist/
npm run preview    # sanity-check the production build locally
```
Deploy the **`dist/`** folder to any static host (Netlify, Vercel, GitHub
Pages). `vite.config.js` sets `base: "./"` so it works from a domain root or a
subpath.

## Config
Supabase URL + anon key default to the project's public values in
`src/config.js`. Override at build time with a `.env`:
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```
The anon key is public by design (writes are governed by RLS); never put the
`service_role` key here.

## What it does
- Filters: metro, recency (posted ≤ 24h / 7d / 30d, from `posted_date`),
  status, and firm/role search.
- Header stats: total, new today, tracked, applied, interview, offer.
- Per-role status dropdown → upserts to `applications` (deleting the row when
  set back to "Track…"). Setting **Applied** stamps `applied_at` with today.
- Optimistic UI with revert-on-error.
