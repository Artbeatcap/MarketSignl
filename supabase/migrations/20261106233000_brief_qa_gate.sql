-- Pre-send brief QA: our own level ledger, internal reference notes, and QA runs.
-- reference_notes is service-role only. No policy is granted to anon or authenticated.

create table if not exists public.brief_levels (
  id bigserial primary key,
  brief_as_of date not null,
  edition text not null check (edition in ('morning','close','weekly')),
  ticker text not null,
  level numeric not null,
  condition text not null check (condition in ('hold','reclaim','break','close_above','close_below')),
  horizon_sessions smallint not null default 1,
  status text not null default 'open' check (status in ('open','met','failed','expired')),
  resolved_at date,
  evidence jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_brief_levels_open on public.brief_levels(status, ticker);

alter table public.brief_levels enable row level security;
revoke all on public.brief_levels from anon, authenticated;
grant select, insert, update, delete on public.brief_levels to service_role;

create table if not exists public.reference_notes (
  id bigserial primary key,
  source text not null,
  published_date date,
  title text,
  url text,
  transcript text not null,
  ingested_at timestamptz not null default now()
);
create index if not exists idx_reference_notes_ingested on public.reference_notes(ingested_at desc);

alter table public.reference_notes enable row level security;
revoke all on public.reference_notes from anon, authenticated;
grant select, insert, update, delete on public.reference_notes to service_role;

create table if not exists public.brief_qa_runs (
  id bigserial primary key,
  as_of date not null,
  edition text not null,
  status text not null,
  fixes jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  coverage_gaps jsonb not null default '[]'::jsonb,
  levels_graded jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_brief_qa_runs_as_of on public.brief_qa_runs(as_of desc, edition);

alter table public.brief_qa_runs enable row level security;
revoke all on public.brief_qa_runs from anon, authenticated;
grant select, insert, update, delete on public.brief_qa_runs to service_role;
