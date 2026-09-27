-- Run AFTER the login page is live and both of you can sign in.
-- Removes the old open (anon) write access to Street Watch's tracker tables,
-- so only signed-in users can change them. Role lists stay publicly readable.
drop policy if exists "apps anon read"       on public.applications;
drop policy if exists "apps anon write"      on public.applications;
drop policy if exists "apps anon update"     on public.applications;
drop policy if exists "apps anon delete"     on public.applications;
drop policy if exists "searches anon read"   on public.saved_searches;
drop policy if exists "searches anon write"  on public.saved_searches;
drop policy if exists "searches anon update" on public.saved_searches;
drop policy if exists "searches anon delete" on public.saved_searches;
drop policy if exists "custom anon read"     on public.custom_jobs;
drop policy if exists "custom anon write"    on public.custom_jobs;
drop policy if exists "custom anon update"   on public.custom_jobs;
drop policy if exists "custom anon delete"   on public.custom_jobs;
