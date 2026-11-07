-- Limited Postgres role for the personal transcript workflow.
-- Apply after supabase/migrations/20261104210000_transcripts.sql.
-- Set a strong password, store it only in the n8n Postgres credential, then rotate this placeholder.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'transcripts_n8n') then
    create role transcripts_n8n login password 'CHANGE_ME_ROTATE_AFTER_CREATE';
  end if;
end $$;

grant usage on schema public to transcripts_n8n;

grant select, insert, update on public.transcripts to transcripts_n8n;
grant select, insert, update on public.transcript_runs to transcripts_n8n;
grant select, insert, update on public.transcript_channel_cache to transcripts_n8n;
grant select, insert, update on public.transcript_credit_months to transcripts_n8n;

revoke all on public.transcripts from public;
revoke all on public.transcript_runs from public;
revoke all on public.transcript_channel_cache from public;
revoke all on public.transcript_credit_months from public;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transcripts' and policyname = 'transcripts_n8n all'
  ) then
    create policy "transcripts_n8n all" on public.transcripts
      for all to transcripts_n8n using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transcript_runs' and policyname = 'transcript_runs_n8n all'
  ) then
    create policy "transcript_runs_n8n all" on public.transcript_runs
      for all to transcripts_n8n using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transcript_channel_cache' and policyname = 'transcript_channel_cache_n8n all'
  ) then
    create policy "transcript_channel_cache_n8n all" on public.transcript_channel_cache
      for all to transcripts_n8n using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transcript_credit_months' and policyname = 'transcript_credit_months_n8n all'
  ) then
    create policy "transcript_credit_months_n8n all" on public.transcript_credit_months
      for all to transcripts_n8n using (true) with check (true);
  end if;
end $$;

comment on role transcripts_n8n is
  'n8n transcript writer: SELECT/INSERT/UPDATE only on transcript tables';
