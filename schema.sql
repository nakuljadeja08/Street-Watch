-- Street Watch — Supabase schema
-- Run this once in your Supabase project (SQL Editor).

create table if not exists public.jobs (
  id          text primary key,          -- stable dedupe key from the ATS
  firm        text not null,
  title       text not null,
  location    text,
  metro       text,                       -- 'NY + Jersey City' | 'SF / Bay Area' | 'Chicago'
  source      text,                       -- greenhouse | ashby | workday | goldman
  url         text,
  posted_date date,                        -- when the firm posted it (greenhouse/ashby); null if unknown
  first_seen  date,
  is_new      boolean default false,
  updated_at  timestamptz default now()
);

-- If the table already exists from an earlier run, add the new column in place:
alter table public.jobs add column if not exists posted_date date;

create index if not exists jobs_metro_idx on public.jobs (metro);
create index if not exists jobs_firm_idx  on public.jobs (firm);

-- Row Level Security: let the public (anon key) READ, but only the service
-- key (used by the pipeline) WRITE.
alter table public.jobs enable row level security;

drop policy if exists "public read" on public.jobs;
create policy "public read"
  on public.jobs for select
  to anon
  using (true);

-- No insert/update policy for anon => writes require the service_role key,
-- which bypasses RLS. The pipeline uses SUPABASE_SERVICE_KEY for that.
