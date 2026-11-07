-- Structure alert run ledger (lower-high and future structure rules).
-- Writes via limited role structure_alert_n8n (see market-alerts/sql/structure_alert_role.sql).

create table if not exists public.structure_alert_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'ok', 'failed')),
  n8n_execution_id text,
  alert_count integer not null default 0,
  tickers text[] not null default '{}',
  error text,
  notify_error text,
  slack_ts text,
  run_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Back-compat if an older revision created the table without run_at
alter table public.structure_alert_runs
  add column if not exists run_at timestamptz not null default now();

create index if not exists structure_alert_runs_run_at_idx
  on public.structure_alert_runs (run_at desc);

create index if not exists structure_alert_runs_exec_idx
  on public.structure_alert_runs (n8n_execution_id)
  where n8n_execution_id is not null;

create index if not exists structure_alert_runs_running_idx
  on public.structure_alert_runs (status, run_at)
  where status = 'running';

-- Fired setups (dedupe key = ticker|h1_date|retest_date)
create table if not exists public.structure_alerts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.structure_alert_runs (id) on delete set null,
  dedupe_key text not null unique,
  ticker text not null,
  rule text not null default 'lower_high',
  h1_date date not null,
  retest_date date not null,
  payload jsonb not null default '{}',
  slack_ts text,
  fired_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Migrate rename if an older setups table exists
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'structure_alert_setups'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'structure_alerts'
  ) then
    alter table public.structure_alert_setups rename to structure_alerts;
  end if;
end $$;

create index if not exists structure_alerts_ticker_idx
  on public.structure_alerts (ticker, fired_at desc);

alter table public.structure_alert_runs enable row level security;
alter table public.structure_alerts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'structure_alert_runs'
      and policyname = 'structure_alert_runs readable by authenticated'
  ) then
    create policy "structure_alert_runs readable by authenticated"
      on public.structure_alert_runs for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'structure_alerts'
      and policyname = 'structure_alerts readable by authenticated'
  ) then
    create policy "structure_alerts readable by authenticated"
      on public.structure_alerts for select
      to authenticated
      using (true);
  end if;
end $$;
