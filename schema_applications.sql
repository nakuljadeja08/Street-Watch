-- Street Watch — application-tracker schema
-- Run once in the Supabase SQL editor (adds the table the dashboard writes to).
--
-- SECURITY NOTE: this uses OPEN anon read+write (personal-tracker mode). Anyone
-- who has your deployed URL + anon key can read and modify these rows. That's
-- fine for a private/unshared tracker. If you ever share the page, switch to
-- Supabase Auth and scope the policies to auth.uid().

create table if not exists public.applications (
  job_id      text primary key
                references public.jobs(id) on delete cascade,
  status      text not null default 'interested',   -- interested|applied|interview|offer|rejected
  applied_at  date,                                  -- set when status first becomes 'applied'
  notes       text,
  updated_at  timestamptz not null default now()
);

create index if not exists applications_status_idx on public.applications (status);

-- keep updated_at fresh on every write
create or replace function public.applications_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.applications_touch_updated_at();

-- Row Level Security: personal-tracker mode — anon may read AND write.
alter table public.applications enable row level security;

drop policy if exists "apps anon read"   on public.applications;
drop policy if exists "apps anon write"  on public.applications;
drop policy if exists "apps anon update" on public.applications;
drop policy if exists "apps anon delete" on public.applications;

create policy "apps anon read"   on public.applications for select to anon using (true);
create policy "apps anon write"  on public.applications for insert to anon with check (true);
create policy "apps anon update" on public.applications for update to anon using (true) with check (true);
create policy "apps anon delete" on public.applications for delete to anon using (true);
