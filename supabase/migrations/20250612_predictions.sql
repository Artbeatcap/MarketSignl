-- MarketSignl: predictions table + usage counter fields
-- Safe to run on fresh OR existing Supabase projects.
--
-- If you have NEVER run schema.sql, this migration bootstraps the required
-- base tables (profiles, usage_counters) before adding predictions support.
--
-- Recommended order for a brand-new project:
--   1. schema.sql
--   2. subscriptions_migration.sql (optional)
--   3. This file
--
-- If schema.sql was skipped, this file will still work.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Bootstrap base tables when missing (fresh Supabase project)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  email text not null,
  display_name text,
  trading_style text,
  experience_level text,
  stress_reducer text,
  is_pro boolean default false,
  pro_expires_at timestamptz,
  onboarding_completed boolean default false,
  push_notifications_enabled boolean default true,
  alert_sound_enabled boolean default true
);

create table if not exists public.usage_counters (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  free_analyses_used integer default 0 not null,
  last_analysis_at timestamptz,
  monthly_analyses integer default 0,
  month_start date default date_trunc('month', now())::date,
  free_predictions_used integer default 0 not null,
  last_prediction_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Extend existing usage_counters (projects that ran schema.sql earlier)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'usage_counters'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'usage_counters'
        and column_name = 'free_predictions_used'
    ) then
      alter table public.usage_counters
        add column free_predictions_used integer default 0 not null;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'usage_counters'
        and column_name = 'last_prediction_at'
    ) then
      alter table public.usage_counters
        add column last_prediction_at timestamptz;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Predictions table
-- ---------------------------------------------------------------------------

create table if not exists public.predictions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  symbol text not null,
  interval text not null,
  headline text,
  expected_change_pct numeric,
  confidence integer,
  direction text check (direction in ('bullish', 'bearish', 'neutral')),
  prediction_json jsonb not null
);

create index if not exists idx_predictions_user_id on public.predictions(user_id);
create index if not exists idx_predictions_created_at on public.predictions(created_at desc);
create index if not exists idx_predictions_symbol on public.predictions(symbol);

-- ---------------------------------------------------------------------------
-- RLS (idempotent)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.usage_counters enable row level security;
alter table public.predictions enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can view own usage" on public.usage_counters;
create policy "Users can view own usage"
  on public.usage_counters for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own predictions" on public.predictions;
create policy "Users can view own predictions"
  on public.predictions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own predictions" on public.predictions;
create policy "Users can insert own predictions"
  on public.predictions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own predictions" on public.predictions;
create policy "Users can delete own predictions"
  on public.predictions for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-create profile + usage row on signup (if not already present)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.usage_counters (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Verify (optional — run separately):
-- select table_name from information_schema.tables
-- where table_schema = 'public'
--   and table_name in ('profiles', 'usage_counters', 'predictions');
