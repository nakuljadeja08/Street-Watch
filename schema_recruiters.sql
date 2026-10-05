-- Recruiter directory + outreach tracker (both watches).
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- The firms and contacts come from a private recruiter list loaded by
-- import_recruiters.py; they are NEVER committed to this (public) repo or
-- bundled into the dashboard. Every table here is readable only by the two
-- signed-in profiles in public.user_profiles, not by any authenticated user,
-- and not by anon.

create table if not exists public.recruiter_firms (
  id           text primary key,               -- slug of the firm name
  name         text not null,
  type         text,                           -- Contingency / Retained / Retained (AESC or major)
  min_salary   integer,                        -- the firm's minimum salary for assignments
  website      text,
  phone        text,
  hq           text,
  about        text,
  industries   text,                           -- the list's full industry text
  positions    text,                           -- the list's full position text
  updated_at   timestamptz default now()
);

create table if not exists public.recruiter_contacts (
  id           text primary key,               -- firm slug + person slug
  firm_id      text not null references public.recruiter_firms(id) on delete cascade,
  name         text not null,
  title        text,
  email        text,
  ind_codes    text[] default '{}',            -- e.g. {FIN,BAN,INV}; from the list, else derived from the firm
  pos_codes    text[] default '{}',            -- e.g. {QNT,FIN,RIS}
  codes_derived boolean default false,         -- true when the codes came from the firm, not the person
  level        text,                           -- 'senior' (partner/MD/founder) | 'recruiter'
  street_score integer,                        -- fit for Street Watch outreach; null = not relevant
  tech_score   integer,                        -- fit for Tech Watch outreach; null = not relevant
  updated_at   timestamptz default now()
);
create index if not exists recruiter_contacts_firm_idx on public.recruiter_contacts (firm_id);

-- One row per (watch, contact) once you act on a contact. Each watch keeps
-- its own outreach, so Ms Tian's and Nakul's tracking never mix.
create table if not exists public.recruiter_outreach (
  watch          text not null check (watch in ('street', 'tech')),
  contact_id     text not null references public.recruiter_contacts(id) on delete cascade,
  status         text not null default 'none'
                 check (status in ('none', 'emailed', 'replied', 'call', 'follow_up', 'not_interested')),
  next_date      date,                         -- follow-up reminder
  last_contacted date,
  notes          text,
  draft_subject  text,
  draft_body     text,
  drafted_at     timestamptz,
  updated_at     timestamptz default now(),
  primary key (watch, contact_id)
);

alter table public.recruiter_firms    enable row level security;
alter table public.recruiter_contacts enable row level security;
alter table public.recruiter_outreach enable row level security;

-- "member" = signed in AND listed in user_profiles. Sign-ups are open on the
-- project, so plain `authenticated` would also admit a stranger who registered.
drop policy if exists "recruiter firms members read"    on public.recruiter_firms;
drop policy if exists "recruiter contacts members read" on public.recruiter_contacts;
drop policy if exists "recruiter outreach members rw"   on public.recruiter_outreach;
create policy "recruiter firms members read" on public.recruiter_firms
  for select to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()));
create policy "recruiter contacts members read" on public.recruiter_contacts
  for select to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()));
create policy "recruiter outreach members rw" on public.recruiter_outreach
  for all to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()))
  with check (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()));
-- No anon policies: anon gets nothing. Writes to firms/contacts need the
-- service key (import_recruiters.py).
