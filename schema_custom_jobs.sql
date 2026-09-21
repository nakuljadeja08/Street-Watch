-- Street Watch — custom (off-list) applications schema
-- Run once in the Supabase SQL editor.
--
-- Lets you track roles you applied to that AREN'T in the scraped `jobs` feed.
-- Unlike `applications`, this table carries the role details inline (firm, title,
-- url, …) and does NOT reference public.jobs — so anon can insert freely without
-- a matching scraped row. Same personal-tracker RLS posture as `applications`:
-- open anon read+write (fine for a private/unshared tracker; switch to Supabase
-- Auth + auth.uid() scoping if you ever share the page).

create table if not exists public.custom_jobs (
  id          uuid primary key default gen_random_uuid(),
  firm        text not null,
  title       text not null,
  location    text,
  metro       text,                                   -- optional; matches the metro filter
  url         text,
  status      text not null default 'applied',        -- interested|applied|interview|offer|rejected
  applied_at  date,                                   -- set when status is/first becomes 'applied'
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists custom_jobs_status_idx on public.custom_jobs (status);

-- keep updated_at fresh on every write
create or replace function public.custom_jobs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists custom_jobs_touch on public.custom_jobs;
create trigger custom_jobs_touch before update on public.custom_jobs
  for each row execute function public.custom_jobs_touch_updated_at();

-- Row Level Security: personal-tracker mode — anon may read AND write.
alter table public.custom_jobs enable row level security;

drop policy if exists "custom anon read"   on public.custom_jobs;
drop policy if exists "custom anon write"  on public.custom_jobs;
drop policy if exists "custom anon update" on public.custom_jobs;
drop policy if exists "custom anon delete" on public.custom_jobs;

create policy "custom anon read"   on public.custom_jobs for select to anon using (true);
create policy "custom anon write"  on public.custom_jobs for insert to anon with check (true);
create policy "custom anon update" on public.custom_jobs for update to anon using (true) with check (true);
create policy "custom anon delete" on public.custom_jobs for delete to anon using (true);
