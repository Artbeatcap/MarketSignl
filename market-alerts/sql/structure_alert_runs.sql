-- Canonical: supabase/20261104_structure_alert_runs.sql
-- Plus limited role: sql/structure_alert_role.sql

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

alter table public.structure_alert_runs
  add column if not exists run_at timestamptz not null default now();

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

alter table public.structure_alert_runs enable row level security;
alter table public.structure_alerts enable row level security;
