-- Tech Watch — Supabase schema (data engineering board).
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Separate tables from Street Watch so each board's numbers and trend chart
-- stay clean. Written by tech_pipeline.py (service key); read by the dashboard.

-- ------------------------------------------------------------------ roles
create table if not exists public.tech_jobs (
  id          text primary key,
  firm        text not null,
  title       text not null,
  location    text,
  metro       text,                 -- hub: 'NYC Area' | 'SF Bay Area' | … | 'Remote (US)' | 'Other US'
  sector      text,                 -- 'Tech' | 'Fintech' | 'Finance' | 'Agency'
  source      text,
  url         text,
  posted_date date,
  first_seen  date,
  is_new      boolean default false,
  updated_at  timestamptz default now()
);
create index if not exists tech_jobs_firm_updated_idx on public.tech_jobs (firm, updated_at);
create index if not exists tech_jobs_metro_idx on public.tech_jobs (metro);

-- ------------------------------------------------------------------ trends
create table if not exists public.tech_hiring_trends (
  day           date not null,
  firm          text not null,
  metro         text not null,
  new_count     integer not null default 0,
  removed_count integer not null default 0,
  active_count  integer not null default 0,
  primary key (day, firm, metro)
);
create index if not exists tech_hiring_trends_day_idx on public.tech_hiring_trends (day);

-- ------------------------------------------------------------------ tracker
create table if not exists public.tech_applications (
  job_id      text primary key references public.tech_jobs(id) on delete cascade,
  status      text not null default 'interested',
  applied_at  date,
  notes       text,
  updated_at  timestamptz not null default now()
);
drop trigger if exists tech_applications_touch on public.tech_applications;
create trigger tech_applications_touch before update on public.tech_applications
  for each row execute function public.applications_touch_updated_at();

create table if not exists public.tech_saved_searches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  filters     jsonb not null default '{}'::jsonb,   -- {metro, sector, q}
  last_seen   date not null default (current_date - 1),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ AI (private)
-- Same shape as Street Watch's profile / ai_fit / ai_drafts, for Nakul's
-- resume. Service key only (the /api routes). job_details is shared.
create table if not exists public.tech_profile (
  id           int primary key default 1 check (id = 1),
  resume_text  text not null,
  updated_at   timestamptz not null default now()
);
create table if not exists public.tech_ai_fit (
  job_id      text primary key,
  score       int not null check (score between 0 and 100),
  reason      text not null,
  model       text,
  created_at  timestamptz not null default now()
);
create table if not exists public.tech_ai_drafts (
  job_id        text primary key,
  cover_letter  text not null,
  why_firm      text not null,
  model         text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ access
-- Roles and trends: readable by anyone with the anon key (like Street Watch).
-- Tracker + saved searches: signed-in users only (see schema_auth.sql).
alter table public.tech_jobs           enable row level security;
alter table public.tech_hiring_trends  enable row level security;
alter table public.tech_applications   enable row level security;
alter table public.tech_saved_searches enable row level security;
alter table public.tech_profile        enable row level security;
alter table public.tech_ai_fit         enable row level security;
alter table public.tech_ai_drafts      enable row level security;

drop policy if exists "tech jobs read"   on public.tech_jobs;
drop policy if exists "tech trends read" on public.tech_hiring_trends;
create policy "tech jobs read"   on public.tech_jobs          for select to anon, authenticated using (true);
create policy "tech trends read" on public.tech_hiring_trends for select to anon, authenticated using (true);

drop policy if exists "tech apps rw"     on public.tech_applications;
drop policy if exists "tech searches rw" on public.tech_saved_searches;
create policy "tech apps rw"     on public.tech_applications   for all to authenticated using (true) with check (true);
create policy "tech searches rw" on public.tech_saved_searches for all to authenticated using (true) with check (true);
