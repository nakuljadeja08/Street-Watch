-- To-do notepad on the homepage of both watches.
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- One list per watch (Street Watch, Tech Watch). Until this runs, the
-- notepad still works but keeps its items in that browser only; the first
-- load after the table exists moves those items up here.

create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  watch      text not null check (watch in ('street', 'tech')),
  text       text not null check (length(text) between 1 and 500),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists todos_watch_idx on public.todos (watch, created_at);

alter table public.todos enable row level security;

-- "member" = signed in AND listed in user_profiles. Sign-ups are open on the
-- project, so plain `authenticated` would also admit a stranger who registered.
drop policy if exists "todos members rw" on public.todos;
create policy "todos members rw" on public.todos
  for all to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()))
  with check (exists (select 1 from public.user_profiles p where p.user_id = auth.uid()));
-- No anon policies: anon gets nothing.
