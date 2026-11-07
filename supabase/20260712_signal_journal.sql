-- Auto-journal: mechanical outcomes (auto-filled nightly) + discretion capture.
-- Prerequisite: run 20260711_sniper_alerts.sql first if table does not exist.
-- Run in Supabase SQL editor.

alter table public.sniper_alerts
  add column if not exists slack_ts text,                -- message ts for reaction capture
  add column if not exists taken boolean,                 -- white_check_mark reaction on the alert
  add column if not exists outcome_filled boolean not null default false,
  add column if not exists exit_ema9 numeric,             -- 9EMA-cross exit px
  add column if not exists exit_ema9_pct numeric,
  add column if not exists exit_zone1_pct numeric,        -- e9+1% extension fill
  add column if not exists exit_zone2_pct numeric,        -- e9+2% extension fill
  add column if not exists eod_pct numeric,
  add column if not exists oracle_pct numeric,            -- best possible
  add column if not exists mae_pct numeric,
  add column if not exists stop_hit boolean,
  add column if not exists r_multiple numeric,            -- 9EMA-exit outcome in R
  add column if not exists notes text;                    -- freeform (in-app, later)

create or replace view public.journal_digest as
select
  date_trunc('week', fired_at) as week,
  alert_type,
  count(*)                                   as signals,
  count(*) filter (where taken)              as taken,
  round(avg(exit_ema9_pct) filter (where outcome_filled), 2)              as sys_avg_pct,
  round(avg(exit_ema9_pct) filter (where taken and outcome_filled), 2)    as taken_avg_pct,
  round(avg(r_multiple)    filter (where outcome_filled), 2)              as sys_avg_r,
  round(avg(mae_pct)       filter (where outcome_filled), 2)              as avg_mae,
  count(*) filter (where atlas->>'verdict' = 'supports' and exit_ema9_pct > 0)  as atlas_sup_wins,
  count(*) filter (where atlas->>'verdict' = 'supports')                        as atlas_sup_total
from public.sniper_alerts
where alert_type in ('day2_reclaim', 'anchor_reclaim')
group by 1, 2
order by 1 desc;
