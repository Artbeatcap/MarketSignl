-- 30-day cache of Polygon/Massive ticker reference for notable-movers filtering

create table if not exists public.ticker_metadata (
  ticker text primary key,
  name text not null,
  type text not null,
  market text not null,
  active boolean not null default true,
  primary_exchange text,
  market_cap numeric,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_ticker_metadata_fetched_at
  on public.ticker_metadata (fetched_at);

alter table public.ticker_metadata enable row level security;
