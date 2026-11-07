-- Limited Postgres role for n8n structure alerts (replaces service-role key).
-- Apply after structure_alert_runs / structure_alerts tables exist.
-- Set a strong password via: \set alert_pwd 'YOUR_PASSWORD'

-- Tables expected:
--   public.structure_alert_runs
--   public.structure_alerts

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'structure_alert_n8n') then
    create role structure_alert_n8n login password 'CHANGE_ME_ROTATE_AFTER_CREATE';
  end if;
end $$;

grant usage on schema public to structure_alert_n8n;

grant select, insert, update on public.structure_alert_runs to structure_alert_n8n;
grant select, insert, update on public.structure_alerts to structure_alert_n8n;

-- Identity columns (uuid defaults / sequences if any)
grant usage, select on all sequences in schema public to structure_alert_n8n;

-- Optional: allow the role to use gen_random_uuid via pgcrypto/extensions already available
-- No DELETE, no DDL, no access to other tables.

revoke all on public.structure_alert_runs from public;
revoke all on public.structure_alerts from public;

comment on role structure_alert_n8n is
  'n8n structure-alert writer: INSERT/UPDATE/SELECT only on structure_alert_runs + structure_alerts';
