-- Transcript ledger for the personal n8n workflow (market-alerts/n8n/transcripts.json).
-- Writes go through the limited role transcripts_n8n (market-alerts/sql/transcripts_role.sql).
-- The Google Drive folder "Trading Transcripts" stays private to the owner.

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  item_id text not null,
  title text,
  published_at timestamptz,
  status text not null check (status in ('saved', 'waiting', 'failed')),
  method text check (method in ('provider_primary', 'provider_secondary', 'yt_dlp', 'feed_vtt')),
  drive_file_id text,
  chars integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, item_id)
);

create index if not exists transcripts_slug_status_idx
  on public.transcripts (slug, status);

create table if not exists public.transcript_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  status text not null check (status in ('running', 'ok', 'failed')),
  saved integer not null default 0,
  waiting integer not null default 0,
  failed integer not null default 0,
  credits_used integer not null default 0,
  error text,
  n8n_execution_id text,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists transcript_runs_run_at_idx
  on public.transcript_runs (run_at desc);

create index if not exists transcript_runs_running_idx
  on public.transcript_runs (status, run_at)
  where status = 'running';

create table if not exists public.transcript_channel_cache (
  slug text primary key,
  handle text not null,
  channel_id text not null,
  resolved_at timestamptz not null default now()
);

create table if not exists public.transcript_credit_months (
  month_start date primary key,
  credits_used integer not null default 0,
  warning_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.transcripts enable row level security;
alter table public.transcript_runs enable row level security;
alter table public.transcript_channel_cache enable row level security;
alter table public.transcript_credit_months enable row level security;
