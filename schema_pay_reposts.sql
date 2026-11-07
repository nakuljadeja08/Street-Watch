-- Pay ranges, reposts and takedown flags (added 2026-11-07), both watches.
-- Run once in the Supabase SQL editor. Until it's run, the daily pull still
-- works: it pushes rows without these columns and skips the takedown check.
--
--   pay_min / pay_max  base pay read from the posting, whole dollars
--   pay_period         'year' or 'hour'
--   repost_count       times the firm took the role down and posted it again
--   orig_first_seen    when the role was first seen, before any repost
--   taken_down_on      set on TRACKED roles the firm has removed (they stay
--                      in the table for the tracker); cleared if it returns

alter table public.jobs
  add column if not exists pay_min         integer,
  add column if not exists pay_max         integer,
  add column if not exists pay_period      text,
  add column if not exists repost_count    integer not null default 0,
  add column if not exists orig_first_seen date,
  add column if not exists taken_down_on   date;

alter table public.tech_jobs
  add column if not exists pay_min         integer,
  add column if not exists pay_max         integer,
  add column if not exists pay_period      text,
  add column if not exists repost_count    integer not null default 0,
  add column if not exists orig_first_seen date,
  add column if not exists taken_down_on   date;
