-- Prediction resolution scoring (lazy resolve on read)
-- Adds columns to persist outcome vs forecast.

alter table public.predictions
  add column if not exists entry_close numeric,
  add column if not exists horizon_end_at timestamptz,
  add column if not exists resolved_price numeric,
  add column if not exists actual_change_pct numeric,
  add column if not exists direction_hit boolean,
  add column if not exists band_contained boolean,
  add column if not exists magnitude_error_pct numeric,
  add column if not exists resolved_at timestamptz;

create index if not exists idx_predictions_unresolved
  on public.predictions (user_id, horizon_end_at)
  where resolved_at is null;
