-- Keep an anonymized copy of issued analyses and prediction outcomes.
-- Customer deletes still remove the live rows. Account deletion nulls user_id.
-- No email, display name, or chart image is stored here.

create table if not exists public.analysis_performance_records (
  analysis_id    uuid primary key,
  user_id        uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null,
  symbol         text,
  timeframe      text,
  analysis_json  jsonb not null,
  prompt_version text,
  copied_at      timestamptz not null default now()
);

create index if not exists analysis_performance_records_symbol_created_at_idx
  on public.analysis_performance_records (symbol, created_at);

create table if not exists public.prediction_performance_records (
  prediction_id          uuid primary key,
  user_id                uuid references public.profiles(id) on delete set null,
  analysis_id            uuid,
  created_at             timestamptz not null,
  symbol                 text,
  interval               text,
  direction              text,
  expected_change_pct    numeric,
  confidence             integer,
  entry_close            numeric,
  horizon_end_at         timestamptz,
  resolved_price         numeric,
  actual_change_pct      numeric,
  direction_hit          boolean,
  band_contained         boolean,
  magnitude_error_pct    numeric,
  resolved_at            timestamptz,
  prediction_json        jsonb not null,
  copied_at              timestamptz not null default now()
);

create index if not exists prediction_performance_records_symbol_created_at_idx
  on public.prediction_performance_records (symbol, created_at);

create table if not exists public.alert_performance_records (
  alert_id      uuid primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  analysis_id   uuid,
  created_at    timestamptz not null,
  symbol        text,
  level_price   numeric,
  level_type    text,
  direction     text,
  status        text,
  triggered_at  timestamptz,
  copied_at     timestamptz not null default now()
);

create index if not exists alert_performance_records_symbol_created_at_idx
  on public.alert_performance_records (symbol, created_at);

alter table public.analysis_performance_records enable row level security;
alter table public.prediction_performance_records enable row level security;
alter table public.alert_performance_records enable row level security;

revoke all on public.analysis_performance_records from anon, authenticated;
revoke all on public.prediction_performance_records from anon, authenticated;
revoke all on public.alert_performance_records from anon, authenticated;
grant all on public.analysis_performance_records to service_role;
grant all on public.prediction_performance_records to service_role;
grant all on public.alert_performance_records to service_role;

create or replace function public.copy_analysis_performance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analysis_performance_records (
    analysis_id, user_id, created_at, symbol, timeframe, analysis_json, prompt_version
  ) values (
    new.id, new.user_id, new.created_at, new.symbol, new.timeframe, new.analysis_json, null
  )
  on conflict (analysis_id) do update set
    user_id = excluded.user_id,
    symbol = excluded.symbol,
    timeframe = excluded.timeframe,
    analysis_json = excluded.analysis_json,
    copied_at = now();
  return new;
end;
$$;

create or replace function public.copy_prediction_performance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.prediction_performance_records (
    prediction_id, user_id, analysis_id, created_at, symbol, interval,
    direction, expected_change_pct, confidence, entry_close, horizon_end_at,
    resolved_price, actual_change_pct, direction_hit, band_contained,
    magnitude_error_pct, resolved_at, prediction_json
  ) values (
    new.id, new.user_id, new.analysis_id, new.created_at, new.symbol, new.interval,
    new.direction, new.expected_change_pct, new.confidence, new.entry_close, new.horizon_end_at,
    new.resolved_price, new.actual_change_pct, new.direction_hit, new.band_contained,
    new.magnitude_error_pct, new.resolved_at, new.prediction_json
  )
  on conflict (prediction_id) do update set
    user_id = excluded.user_id,
    analysis_id = excluded.analysis_id,
    symbol = excluded.symbol,
    interval = excluded.interval,
    direction = excluded.direction,
    expected_change_pct = excluded.expected_change_pct,
    confidence = excluded.confidence,
    entry_close = excluded.entry_close,
    horizon_end_at = excluded.horizon_end_at,
    resolved_price = excluded.resolved_price,
    actual_change_pct = excluded.actual_change_pct,
    direction_hit = excluded.direction_hit,
    band_contained = excluded.band_contained,
    magnitude_error_pct = excluded.magnitude_error_pct,
    resolved_at = excluded.resolved_at,
    prediction_json = excluded.prediction_json,
    copied_at = now();
  return new;
end;
$$;

create or replace function public.copy_alert_performance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id uuid;
begin
  select id into profile_id from public.profiles where id = new.user_id;
  insert into public.alert_performance_records (
    alert_id, user_id, analysis_id, created_at, symbol, level_price,
    level_type, direction, status, triggered_at
  ) values (
    new.id, profile_id, new.analysis_id, new.created_at, new.symbol, new.level_price,
    new.level_type, new.direction, new.status, new.triggered_at
  )
  on conflict (alert_id) do update set
    user_id = excluded.user_id,
    analysis_id = excluded.analysis_id,
    symbol = excluded.symbol,
    level_price = excluded.level_price,
    level_type = excluded.level_type,
    direction = excluded.direction,
    status = excluded.status,
    triggered_at = excluded.triggered_at,
    copied_at = now();
  return new;
end;
$$;

-- Remember linked predictions before the analysis row is removed, then delete
-- them afterward. A BEFORE delete would update this same row and abort.
create or replace function public.note_predictions_for_analysis_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  create temp table if not exists pending_prediction_deletes (
    prediction_id uuid primary key
  ) on commit drop;
  insert into pending_prediction_deletes (prediction_id)
  select p.id
  from public.predictions p
  where p.analysis_id = old.id
     or p.id = old.prediction_id
  on conflict do nothing;
  return old;
end;
$$;

create or replace function public.delete_predictions_with_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('pg_temp.pending_prediction_deletes') is not null then
    delete from public.predictions p
    using pending_prediction_deletes d
    where p.id = d.prediction_id;
    delete from pending_prediction_deletes;
  end if;
  return old;
end;
$$;

drop trigger if exists chart_analyses_copy_performance on public.chart_analyses;
create trigger chart_analyses_copy_performance
  after insert or update on public.chart_analyses
  for each row execute function public.copy_analysis_performance_record();

drop trigger if exists predictions_copy_performance on public.predictions;
create trigger predictions_copy_performance
  after insert or update on public.predictions
  for each row execute function public.copy_prediction_performance_record();

drop trigger if exists price_alerts_copy_performance on public.price_alerts;
create trigger price_alerts_copy_performance
  after insert or update on public.price_alerts
  for each row execute function public.copy_alert_performance_record();

drop trigger if exists chart_analyses_delete_predictions on public.chart_analyses;
drop trigger if exists chart_analyses_note_prediction_deletes on public.chart_analyses;
create trigger chart_analyses_note_prediction_deletes
  before delete on public.chart_analyses
  for each row execute function public.note_predictions_for_analysis_delete();
create trigger chart_analyses_delete_predictions
  after delete on public.chart_analyses
  for each row execute function public.delete_predictions_with_analysis();

revoke all on function public.copy_analysis_performance_record() from public, anon, authenticated;
revoke all on function public.copy_prediction_performance_record() from public, anon, authenticated;
revoke all on function public.copy_alert_performance_record() from public, anon, authenticated;
revoke all on function public.note_predictions_for_analysis_delete() from public, anon, authenticated;
revoke all on function public.delete_predictions_with_analysis() from public, anon, authenticated;

insert into public.analysis_performance_records (
  analysis_id, user_id, created_at, symbol, timeframe, analysis_json, prompt_version
)
select id, user_id, created_at, symbol, timeframe, analysis_json, null
from public.chart_analyses
on conflict (analysis_id) do nothing;

insert into public.prediction_performance_records (
  prediction_id, user_id, analysis_id, created_at, symbol, interval,
  direction, expected_change_pct, confidence, entry_close, horizon_end_at,
  resolved_price, actual_change_pct, direction_hit, band_contained,
  magnitude_error_pct, resolved_at, prediction_json
)
select
  id, user_id, analysis_id, created_at, symbol, interval,
  direction, expected_change_pct, confidence, entry_close, horizon_end_at,
  resolved_price, actual_change_pct, direction_hit, band_contained,
  magnitude_error_pct, resolved_at, prediction_json
from public.predictions
on conflict (prediction_id) do nothing;

insert into public.alert_performance_records (
  alert_id, user_id, analysis_id, created_at, symbol, level_price,
  level_type, direction, status, triggered_at
)
select
  a.id,
  (select p.id from public.profiles p where p.id = a.user_id),
  a.analysis_id, a.created_at, a.symbol, a.level_price,
  a.level_type, a.direction, a.status, a.triggered_at
from public.price_alerts a
on conflict (alert_id) do nothing;
