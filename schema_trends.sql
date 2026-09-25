-- Street Watch — hiring trends (postings added / taken down per day).
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- One row per (day, firm, metro), written by pipeline.py after each daily pull
-- (update_trends / push_trends). The dashboard's Trends view reads it.
--   new_count     roles that appeared on the board that day (first seen)
--   removed_count roles the firm took down since the previous day (gone from
--                 its own careers feed — not roles we merely filtered out)
--   active_count  roles live on the board at the end of that day
create table if not exists public.hiring_trends (
  day           date not null,
  firm          text not null,
  metro         text not null,
  new_count     integer not null default 0,
  removed_count integer not null default 0,
  active_count  integer not null default 0,
  primary key (day, firm, metro)
);

create index if not exists hiring_trends_day_idx on public.hiring_trends (day);

-- Public read (anon key, like `jobs`); writes need the service_role key.
alter table public.hiring_trends enable row level security;
drop policy if exists "trends public read" on public.hiring_trends;
create policy "trends public read" on public.hiring_trends for select to anon using (true);
