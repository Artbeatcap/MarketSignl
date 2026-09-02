-- Provenance columns for the layered earnings calendar.
-- PK stays (ticker, report_date). Unique fiscal key is partial because
-- Stable FMP rows often omit fiscal period.

alter table public.earnings_calendar
  add column if not exists source text not null default 'fmp',
  add column if not exists confidence text not null default 'reported',
  add column if not exists date_status text,
  add column if not exists session_source text,
  add column if not exists fiscal_year integer;

alter table public.earnings_calendar
  drop constraint if exists earnings_calendar_confidence_check;
alter table public.earnings_calendar
  add constraint earnings_calendar_confidence_check
  check (confidence in ('reported', 'projected', 'inferred'));

alter table public.earnings_calendar
  drop constraint if exists earnings_calendar_source_check;
alter table public.earnings_calendar
  add constraint earnings_calendar_source_check
  check (source in ('finnhub', 'fmp', 'alphavantage', 'news'));

create index if not exists earnings_calendar_ticker_fiscal_idx
  on public.earnings_calendar (ticker, fiscal_year, fiscal_period);
