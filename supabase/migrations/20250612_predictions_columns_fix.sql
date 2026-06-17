-- Patch: add prediction usage columns if the main migration created tables but skipped ALTER
alter table public.usage_counters
  add column if not exists free_predictions_used integer default 0 not null;

alter table public.usage_counters
  add column if not exists last_prediction_at timestamptz;
