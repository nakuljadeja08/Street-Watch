-- Login for the two profiles (Street Watch / Tech Watch).
-- Run once in Supabase → SQL Editor, AFTER creating the two users in
-- Authentication → Users → "Add user" (email + password, auto-confirm).
-- Safe to re-run.
--
-- Both people can see both watches; the profile only picks which board you
-- land on after signing in and the name in the header.

create table if not exists public.user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  home_watch   text not null check (home_watch in ('street', 'tech'))
);
alter table public.user_profiles enable row level security;
drop policy if exists "profiles read" on public.user_profiles;
create policy "profiles read" on public.user_profiles for select to authenticated using (true);

-- Fill these in with the two sign-in emails, then run:
-- insert into public.user_profiles (user_id, display_name, home_watch)
--   select id, 'Ms Tian', 'street' from auth.users where email = 'HER_EMAIL'
--   on conflict (user_id) do update set display_name = excluded.display_name, home_watch = excluded.home_watch;
-- insert into public.user_profiles (user_id, display_name, home_watch)
--   select id, 'Nakul', 'tech' from auth.users where email = 'YOUR_EMAIL'
--   on conflict (user_id) do update set display_name = excluded.display_name, home_watch = excluded.home_watch;

-- Street Watch tables: once signed in, requests run as `authenticated`
-- instead of `anon`, so give that role the same access. (The old anon
-- policies stay until the login is live; schema_auth_lockdown.sql removes them.)
drop policy if exists "jobs auth read"     on public.jobs;
drop policy if exists "trends auth read"   on public.hiring_trends;
drop policy if exists "apps auth rw"       on public.applications;
drop policy if exists "searches auth rw"   on public.saved_searches;
drop policy if exists "custom auth rw"     on public.custom_jobs;
create policy "jobs auth read"   on public.jobs           for select to authenticated using (true);
create policy "trends auth read" on public.hiring_trends  for select to authenticated using (true);
create policy "apps auth rw"     on public.applications   for all to authenticated using (true) with check (true);
create policy "searches auth rw" on public.saved_searches for all to authenticated using (true) with check (true);
create policy "custom auth rw"   on public.custom_jobs    for all to authenticated using (true) with check (true);
