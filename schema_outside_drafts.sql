-- Cover letters for jobs that aren't on either board ("✍ Outside job").
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- An outside draft's job_id is "x_<uuid>" and its pasted description is saved
-- in job_details like any other role. The role itself (firm, title, location,
-- url) has no row in jobs / tech_jobs, so it rides along on the draft so the
-- dashboard can list and reopen past outside drafts.
alter table public.ai_drafts      add column if not exists job jsonb;
alter table public.tech_ai_drafts add column if not exists job jsonb;
