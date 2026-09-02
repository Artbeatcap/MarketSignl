-- Forward calendar for the morning brief.
-- earnings_calendar is a nightly FMP cache; the 8:30 send never calls FMP.
-- macro_calendar is curated from official BLS / BEA / FOMC / ISM / Census / UMich
-- schedules. Do not compute these dates from a "first Friday" rule.

create table if not exists public.macro_calendar (
  id           bigserial primary key,
  event_date   date        not null,
  release_time time        not null,
  title        text        not null,
  short_title  text        not null,
  category     text        not null,
  impact       smallint    not null check (impact in (1, 2, 3)),
  source       text        not null,
  consensus    text,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (event_date, title)
);

create index if not exists idx_macro_calendar_date on public.macro_calendar(event_date);

create table if not exists public.earnings_calendar (
  ticker            text        not null,
  report_date       date        not null,
  session           text        not null check (session in ('bmo', 'amc', 'unknown')),
  is_confirmed      boolean     not null default false,
  eps_estimate      numeric,
  revenue_estimate  numeric,
  fiscal_period     text,
  updated_from_date date,
  company_name      text,
  fetched_at        timestamptz not null default now(),
  primary key (ticker, report_date)
);

create index if not exists idx_earnings_calendar_date on public.earnings_calendar(report_date);
create index if not exists idx_earnings_calendar_fetched on public.earnings_calendar(fetched_at);

create table if not exists public.index_weights (
  ticker     text primary key,
  weight_pct numeric not null,
  as_of      date,
  source     text not null default 'seed'
);

create table if not exists public.market_holidays (
  holiday_date date primary key,
  name         text not null default '',
  fetched_at   timestamptz not null default now()
);

alter table public.macro_calendar enable row level security;
alter table public.earnings_calendar enable row level security;
alter table public.index_weights enable row level security;
alter table public.market_holidays enable row level security;

-- Approximate S&P 500 weights, Aug 2026. Refresh quarterly with the watchlist.
-- MIN_CALENDAR_WEIGHT_PCT = 0.35 admits roughly the top 60 names; this seed
-- covers the DRIVER_WATCHLIST plus a few more that clear that floor.
insert into public.index_weights (ticker, weight_pct, as_of, source) values
  ('NVDA',  8.10, '2026-08-31', 'seed-2026-08'),
  ('MSFT',  7.20, '2026-08-31', 'seed-2026-08'),
  ('AAPL',  6.40, '2026-08-31', 'seed-2026-08'),
  ('AMZN',  4.10, '2026-08-31', 'seed-2026-08'),
  ('GOOGL', 2.20, '2026-08-31', 'seed-2026-08'),
  ('GOOG',  1.80, '2026-08-31', 'seed-2026-08'),
  ('META',  3.00, '2026-08-31', 'seed-2026-08'),
  ('AVGO',  2.10, '2026-08-31', 'seed-2026-08'),
  ('TSLA',  1.70, '2026-08-31', 'seed-2026-08'),
  ('BRK.B', 1.65, '2026-08-31', 'seed-2026-08'),
  ('JPM',   1.35, '2026-08-31', 'seed-2026-08'),
  ('LLY',   1.25, '2026-08-31', 'seed-2026-08'),
  ('V',     1.10, '2026-08-31', 'seed-2026-08'),
  ('XOM',   0.95, '2026-08-31', 'seed-2026-08'),
  ('UNH',   0.90, '2026-08-31', 'seed-2026-08'),
  ('MA',    0.88, '2026-08-31', 'seed-2026-08'),
  ('COST',  0.82, '2026-08-31', 'seed-2026-08'),
  ('WMT',   0.78, '2026-08-31', 'seed-2026-08'),
  ('PG',    0.72, '2026-08-31', 'seed-2026-08'),
  ('JNJ',   0.70, '2026-08-31', 'seed-2026-08'),
  ('HD',    0.68, '2026-08-31', 'seed-2026-08'),
  ('NFLX',  0.62, '2026-08-31', 'seed-2026-08'),
  ('ORCL',  0.58, '2026-08-31', 'seed-2026-08'),
  ('ABBV',  0.54, '2026-08-31', 'seed-2026-08'),
  ('BAC',   0.52, '2026-08-31', 'seed-2026-08'),
  ('CRM',   0.50, '2026-08-31', 'seed-2026-08'),
  ('AMD',   0.48, '2026-08-31', 'seed-2026-08'),
  ('CVX',   0.46, '2026-08-31', 'seed-2026-08'),
  ('KO',    0.44, '2026-08-31', 'seed-2026-08'),
  ('MRK',   0.44, '2026-08-31', 'seed-2026-08'),
  ('PEP',   0.42, '2026-08-31', 'seed-2026-08'),
  ('TMO',   0.41, '2026-08-31', 'seed-2026-08'),
  ('LIN',   0.40, '2026-08-31', 'seed-2026-08'),
  ('CSCO',  0.40, '2026-08-31', 'seed-2026-08'),
  ('ACN',   0.39, '2026-08-31', 'seed-2026-08'),
  ('MCD',   0.38, '2026-08-31', 'seed-2026-08'),
  ('WFC',   0.38, '2026-08-31', 'seed-2026-08'),
  ('ABT',   0.37, '2026-08-31', 'seed-2026-08'),
  ('PM',    0.36, '2026-08-31', 'seed-2026-08'),
  ('IBM',   0.36, '2026-08-31', 'seed-2026-08'),
  ('GE',    0.35, '2026-08-31', 'seed-2026-08'),
  ('PLTR',  0.50, '2026-08-31', 'seed-2026-08'),
  ('QCOM',  0.42, '2026-08-31', 'seed-2026-08'),
  ('CAT',   0.40, '2026-08-31', 'seed-2026-08'),
  ('DIS',   0.40, '2026-08-31', 'seed-2026-08'),
  ('RTX',   0.38, '2026-08-31', 'seed-2026-08'),
  ('ADBE',  0.38, '2026-08-31', 'seed-2026-08'),
  ('INTU',  0.37, '2026-08-31', 'seed-2026-08'),
  ('NOW',   0.36, '2026-08-31', 'seed-2026-08'),
  ('TXN',   0.36, '2026-08-31', 'seed-2026-08'),
  ('AMAT',  0.35, '2026-08-31', 'seed-2026-08'),
  ('ISRG',  0.35, '2026-08-31', 'seed-2026-08'),
  ('BKNG',  0.35, '2026-08-31', 'seed-2026-08')
on conflict (ticker) do nothing;

-- Official schedules only. Sources:
-- BLS empsit / cpi / ppi release pages (2026)
-- BEA news/schedule/full (retrieved 2026-08-31)
-- Federal Reserve FOMC calendars (2026 + Jan 2027)
-- ISM PMI report calendar 2026
-- Census advance monthly retail sales 2026
-- UMich SCA release dates (docid 79628 / 75443)

insert into public.macro_calendar
  (event_date, release_time, title, short_title, category, impact, source, notes)
values
  -- Employment situation (BLS, 08:30 ET)
  ('2026-09-04', '08:30:00', 'August Employment Situation', 'Jobs report', 'employment', 3, 'BLS',
    'The last major labor print before the September FOMC.'),
  ('2026-10-02', '08:30:00', 'September Employment Situation', 'Jobs report', 'employment', 3, 'BLS', null),
  ('2026-11-06', '08:30:00', 'October Employment Situation', 'Jobs report', 'employment', 3, 'BLS', null),
  ('2026-12-04', '08:30:00', 'November Employment Situation', 'Jobs report', 'employment', 3, 'BLS', null),

  -- CPI (BLS, 08:30 ET)
  ('2026-09-11', '08:30:00', 'August CPI', 'CPI', 'inflation', 3, 'BLS', null),
  ('2026-10-14', '08:30:00', 'September CPI', 'CPI', 'inflation', 3, 'BLS', null),
  ('2026-11-10', '08:30:00', 'October CPI', 'CPI', 'inflation', 3, 'BLS', null),
  ('2026-12-10', '08:30:00', 'November CPI', 'CPI', 'inflation', 3, 'BLS', null),

  -- PPI (BLS, 08:30 ET)
  ('2026-09-10', '08:30:00', 'August PPI', 'PPI', 'inflation', 3, 'BLS', null),
  ('2026-10-15', '08:30:00', 'September PPI', 'PPI', 'inflation', 3, 'BLS', null),
  ('2026-11-13', '08:30:00', 'October PPI', 'PPI', 'inflation', 3, 'BLS', null),
  ('2026-12-15', '08:30:00', 'November PPI', 'PPI', 'inflation', 3, 'BLS', null),

  -- PCE via Personal Income and Outlays (BEA, 08:30 ET)
  ('2026-09-30', '08:30:00', 'August PCE', 'PCE', 'inflation', 3, 'BEA', null),
  ('2026-10-29', '08:30:00', 'September PCE', 'PCE', 'inflation', 3, 'BEA', null),
  ('2026-11-25', '08:30:00', 'October PCE', 'PCE', 'inflation', 3, 'BEA', null),
  ('2026-12-23', '08:30:00', 'November PCE', 'PCE', 'inflation', 3, 'BEA', null),

  -- FOMC decision + presser as separate rows (Fed, 14:00 / 14:30 ET)
  ('2026-09-16', '14:00:00', 'FOMC decision', 'FOMC', 'fed', 3, 'FOMC', 'SEP / dot plot meeting.'),
  ('2026-09-16', '14:30:00', 'FOMC press conference', 'Fed presser', 'fed', 3, 'FOMC',
    'Moves the tape separately from the statement.'),
  ('2026-10-28', '14:00:00', 'FOMC decision', 'FOMC', 'fed', 3, 'FOMC', null),
  ('2026-10-28', '14:30:00', 'FOMC press conference', 'Fed presser', 'fed', 3, 'FOMC',
    'Moves the tape separately from the statement.'),
  ('2026-12-09', '14:00:00', 'FOMC decision', 'FOMC', 'fed', 3, 'FOMC', 'SEP / dot plot meeting.'),
  ('2026-12-09', '14:30:00', 'FOMC press conference', 'Fed presser', 'fed', 3, 'FOMC',
    'Moves the tape separately from the statement.'),
  ('2027-01-27', '14:00:00', 'FOMC decision', 'FOMC', 'fed', 3, 'FOMC', null),
  ('2027-01-27', '14:30:00', 'FOMC press conference', 'Fed presser', 'fed', 3, 'FOMC',
    'Moves the tape separately from the statement.'),

  -- GDP (BEA, 08:30 ET)
  ('2026-09-30', '08:30:00', 'Q2 GDP third estimate', 'GDP', 'growth', 2, 'BEA', null),
  ('2026-10-29', '08:30:00', 'Q3 GDP advance', 'GDP', 'growth', 2, 'BEA', null),
  ('2026-11-25', '08:30:00', 'Q3 GDP second estimate', 'GDP', 'growth', 2, 'BEA', null),
  ('2026-12-23', '08:30:00', 'Q3 GDP third estimate', 'GDP', 'growth', 2, 'BEA', null),

  -- Retail sales (Census, 08:30 ET)
  ('2026-09-16', '08:30:00', 'August retail sales', 'Retail sales', 'growth', 2, 'Census', null),
  ('2026-10-15', '08:30:00', 'September retail sales', 'Retail sales', 'growth', 2, 'Census', null),
  ('2026-11-17', '08:30:00', 'October retail sales', 'Retail sales', 'growth', 2, 'Census', null),
  ('2026-12-16', '08:30:00', 'November retail sales', 'Retail sales', 'growth', 2, 'Census', null),

  -- ISM (10:00 ET). Manufacturing = 1st business day; services = 3rd, per ISM calendar.
  ('2026-09-01', '10:00:00', 'ISM Manufacturing PMI', 'ISM manufacturing', 'sentiment', 2, 'ISM', null),
  ('2026-09-03', '10:00:00', 'ISM Services PMI', 'ISM services', 'sentiment', 2, 'ISM', null),
  ('2026-10-01', '10:00:00', 'ISM Manufacturing PMI', 'ISM manufacturing', 'sentiment', 2, 'ISM', null),
  ('2026-10-05', '10:00:00', 'ISM Services PMI', 'ISM services', 'sentiment', 2, 'ISM', null),
  ('2026-11-02', '10:00:00', 'ISM Manufacturing PMI', 'ISM manufacturing', 'sentiment', 2, 'ISM', null),
  ('2026-11-04', '10:00:00', 'ISM Services PMI', 'ISM services', 'sentiment', 2, 'ISM', null),
  ('2026-12-01', '10:00:00', 'ISM Manufacturing PMI', 'ISM manufacturing', 'sentiment', 2, 'ISM', null),
  ('2026-12-03', '10:00:00', 'ISM Services PMI', 'ISM services', 'sentiment', 2, 'ISM', null),

  -- UMich sentiment (official SCA calendar, 10:00 ET)
  ('2026-09-11', '10:00:00', 'September UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2026-09-25', '10:00:00', 'September UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2026-10-09', '10:00:00', 'October UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2026-10-23', '10:00:00', 'October UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2026-11-06', '10:00:00', 'November UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2026-11-20', '10:00:00', 'November UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2026-12-04', '10:00:00', 'December UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2026-12-18', '10:00:00', 'December UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-01-08', '10:00:00', 'January UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-01-22', '10:00:00', 'January UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-02-12', '10:00:00', 'February UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-02-26', '10:00:00', 'February UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-03-12', '10:00:00', 'March UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-03-25', '10:00:00', 'March UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-04-09', '10:00:00', 'April UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-04-23', '10:00:00', 'April UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-05-07', '10:00:00', 'May UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-05-21', '10:00:00', 'May UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-06-11', '10:00:00', 'June UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-06-25', '10:00:00', 'June UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-07-16', '10:00:00', 'July UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-07-30', '10:00:00', 'July UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null),
  ('2027-08-13', '10:00:00', 'August UMich sentiment prelim', 'UMich prelim', 'sentiment', 1, 'UMich', null),
  ('2027-08-27', '10:00:00', 'August UMich sentiment final', 'UMich final', 'sentiment', 1, 'UMich', null)
on conflict (event_date, title) do nothing;
