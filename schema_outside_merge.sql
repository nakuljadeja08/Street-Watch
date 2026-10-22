-- Fold old "✍ Outside job" cover letters into the tracker (both watches).
-- Run once in Supabase → SQL Editor, after schema_custom_jobs.sql,
-- schema_tech_custom_jobs.sql and schema_outside_drafts.sql. Safe to re-run
-- (it only touches x_ letters that are left).
--
-- Outside letters used to live apart from the tracker (draft ids "x_<uuid>",
-- role details on the draft's `job` column), so a role had to be typed in
-- twice. Now one "add your own" row (custom_jobs / tech_custom_jobs, id
-- "c_<uuid>") holds both. For each old letter: re-key it onto the tracked
-- role with the same firm and title (ignoring case and punctuation), or, if
-- it was never tracked, add it to the tracker as Applied on the day the
-- letter was written.
create or replace function pg_temp.merge_outside(drafts text, customs text) returns void
language plpgsql as $$
declare
  d   record;
  cid   uuid;
  taken boolean;
begin
  for d in execute format(
    'select job_id, job, created_at from public.%I where job_id like %L and job is not null order by created_at',
    drafts, 'x\_%')
  loop
    execute format(
      'select id from public.%I
        where regexp_replace(lower(firm),  ''[^a-z0-9]'', '''', ''g'') = regexp_replace(lower($1), ''[^a-z0-9]'', '''', ''g'')
          and regexp_replace(lower(title), ''[^a-z0-9]'', '''', ''g'') = regexp_replace(lower($2), ''[^a-z0-9]'', '''', ''g'')
        order by created_at limit 1', customs)
      into cid using d.job->>'firm', d.job->>'title';

    if cid is null then
      execute format(
        'insert into public.%I (firm, title, location, url, status, applied_at, created_at)
         values ($1, $2, $3, $4, ''applied'', $5, $6) returning id', customs)
        into cid
        using trim(d.job->>'firm'),
              trim(d.job->>'title'),
              nullif(trim(d.job->>'location'), ''),
              case when d.job->>'url' ~* '^https?://' then d.job->>'url' end,  -- one old row has the posting pasted as its link
              d.created_at::date,
              d.created_at;
    end if;

    -- a tracked role that already has its own letter keeps it
    execute format('select exists (select 1 from public.%I where job_id = $1)', drafts) into taken using 'c_' || cid;
    continue when taken;

    execute format('update public.%I set job_id = $1, job = null where job_id = $2', drafts) using 'c_' || cid, d.job_id;
    if exists (select 1 from public.job_details where job_id = d.job_id) then
      delete from public.job_details where job_id = 'c_' || cid;
      update public.job_details set job_id = 'c_' || cid where job_id = d.job_id;
    end if;
  end loop;
end $$;

select pg_temp.merge_outside('tech_ai_drafts', 'tech_custom_jobs');
select pg_temp.merge_outside('ai_drafts', 'custom_jobs');
