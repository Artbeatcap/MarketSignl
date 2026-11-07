-- Signals feed table: news-momentum module alerts, readable in-app.
-- Run in Supabase SQL editor.

create table if not exists public.sniper_alerts (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  tier text not null,                    -- 't0' | 't1' | 't2' | 't3' | 't15'
  side text not null,                    -- 'long' | 'short' | 'up' | 'down'
  alert_type text not null,              -- 'pm_mover' | 'ignition' | 'trend_day'
                                         -- | 'day2_retest' | 'day2_reclaim'
                                         -- | 'anchor_sweep' | 'anchor_reclaim'
                                         -- | 'ext_zone1' | 'ext_zone2'
  entry numeric,
  stop numeric,
  levels jsonb not null default '{}',    -- { prenews, cons_low, e200, ... }
  atlas jsonb,                           -- { headline, verdict, confidence, invalidation, keyLevel }
  slack_ts text,
  fired_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sniper_alerts_fired_idx on public.sniper_alerts (fired_at desc);
create index if not exists sniper_alerts_ticker_idx on public.sniper_alerts (ticker, fired_at desc);

alter table public.sniper_alerts enable row level security;

-- Phase 1: owner-only product (your account). Later: gate by subscription tier
-- for a public "Signals" premium feature.
create policy "signals readable by authenticated users"
  on public.sniper_alerts for select
  to authenticated
  using (true);

-- writes only via service role (backend internal route) — no insert policy needed.
