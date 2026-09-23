-- Street Watch — saved searches + AI (fit score, cover letter drafts).
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- ------------------------------------------------------------------ saved searches
-- Named filter sets. The dashboard pins new matching roles; the morning
-- newsletter lists them. Personal-tracker mode like applications: anon r/w.
create table if not exists public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  filters     jsonb not null default '{}'::jsonb,  -- {metro, category, level, q}
  last_seen   date not null default (current_date - 1), -- roles first seen after this count as new
  created_at  timestamptz not null default now()
);

alter table public.saved_searches enable row level security;
drop policy if exists "searches anon read"   on public.saved_searches;
drop policy if exists "searches anon write"  on public.saved_searches;
drop policy if exists "searches anon update" on public.saved_searches;
drop policy if exists "searches anon delete" on public.saved_searches;
create policy "searches anon read"   on public.saved_searches for select to anon using (true);
create policy "searches anon write"  on public.saved_searches for insert to anon with check (true);
create policy "searches anon update" on public.saved_searches for update to anon using (true) with check (true);
create policy "searches anon delete" on public.saved_searches for delete to anon using (true);

-- ------------------------------------------------------------------ AI tables
-- These hold your resume and generated drafts, so they are PRIVATE: RLS is on
-- with no anon policies — only the service_role key (used by the /api routes
-- on Vercel, behind your STREET_WATCH_KEY passphrase) can read or write them.

create table if not exists public.profile (
  id           int primary key default 1 check (id = 1),  -- single row
  resume_text  text not null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.job_details (          -- cached job descriptions
  job_id       text primary key,
  description  text not null,
  fetched_at   timestamptz not null default now()
);

create table if not exists public.ai_fit (
  job_id      text primary key,
  score       int not null check (score between 0 and 100),
  reason      text not null,
  model       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.ai_drafts (
  job_id        text primary key,
  cover_letter  text not null,
  why_firm      text not null,
  model         text,
  created_at    timestamptz not null default now()
);

alter table public.profile     enable row level security;
alter table public.job_details enable row level security;
alter table public.ai_fit      enable row level security;
alter table public.ai_drafts   enable row level security;
