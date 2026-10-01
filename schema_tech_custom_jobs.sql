-- Tech Watch — outside jobs (roles you applied to that aren't on the board)
-- Run once in the Supabase SQL editor, after schema_tech.sql.
--
-- Same idea as Street Watch's custom_jobs: the role details live inline and
-- don't reference tech_jobs, so the daily reconcile never touches them.
-- Signed-in users only, like tech_applications.

create table if not exists public.tech_custom_jobs (
  id          uuid primary key default gen_random_uuid(),
  firm        text not null,
  title       text not null,
  location    text,
  url         text,
  status      text not null default 'applied',        -- interested|applied|interview|offer|rejected
  applied_at  date,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tech_custom_jobs_touch on public.tech_custom_jobs;
create trigger tech_custom_jobs_touch before update on public.tech_custom_jobs
  for each row execute function public.applications_touch_updated_at();

alter table public.tech_custom_jobs enable row level security;
drop policy if exists "tech custom rw" on public.tech_custom_jobs;
create policy "tech custom rw" on public.tech_custom_jobs for all to authenticated using (true) with check (true);
