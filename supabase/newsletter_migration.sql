-- Newsletter subscribers for the ChartSignl daily brief
-- Run this in the Supabase SQL Editor
--
-- RLS is enabled with ZERO policies. No row is visible to anon or authenticated.
-- The backend uses the service role and bypasses RLS.
--
-- Auto-subscribe lives in a trigger on public.profiles, not the client.
-- Read the ON CONFLICT WHERE clause before changing it — that clause is the
-- compliance story. Creating an account must not undo an opt-out.

create extension if not exists citext;
create extension if not exists pgcrypto;

do $$ begin
  create type public.subscriber_status as enum (
    'pending',       -- reserved: double opt-in, not written by any code path today
    'subscribed',
    'unsubscribed',
    'bounced',
    'complained'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.subscriber_source as enum (
    'landing_hero',
    'landing_footer',
    'app_signup',
    'settings_toggle',
    'manual',
    'import'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  user_id uuid references auth.users(id) on delete set null,

  status public.subscriber_status not null default 'subscribed',
  source public.subscriber_source not null,

  -- Consent record. This is what you produce if anyone ever asks.
  consent_ip inet,
  consent_user_agent text,
  subscribed_at timestamptz not null default now(),
  confirmed_at timestamptz,          -- reserved for double opt-in
  unsubscribed_at timestamptz,
  unsubscribe_reason text,

  -- Per-row secret. Not derived from email or user_id.
  unsubscribe_token text not null unique
    default encode(gen_random_bytes(32), 'hex'),

  last_sent_at timestamptz,
  send_count int not null default 0,
  bounce_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_newsletter_status on public.newsletter_subscribers(status);
create index if not exists idx_newsletter_user_id on public.newsletter_subscribers(user_id);
create unique index if not exists idx_newsletter_token on public.newsletter_subscribers(unsubscribe_token);

-- Send ledger: gives idempotency and a history you can audit.
create table if not exists public.newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  send_key text not null unique,     -- e.g. 'daily-brief-2026-08-31'
  subject text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),
  eligible_count int,
  delivered_count int default 0,
  failed_count int default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.newsletter_send_recipients (
  send_id uuid not null references public.newsletter_sends(id) on delete cascade,
  subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
  provider_message_id text,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  primary key (send_id, subscriber_id)
);

-- Webhook idempotency: SendGrid redelivers. bounce_count increments are
-- not themselves idempotent, so we claim each sg_event_id once.
create table if not exists public.newsletter_webhook_events (
  sg_event_id text primary key,
  event text not null,
  email text,
  received_at timestamptz not null default now()
);

-- RLS: enabled with NO policies. No row is visible to anon or authenticated.
-- The backend uses the service role and bypasses RLS.
alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_sends enable row level security;
alter table public.newsletter_send_recipients enable row level security;
alter table public.newsletter_webhook_events enable row level security;

revoke all on table public.newsletter_subscribers from anon, authenticated, public;
revoke all on table public.newsletter_sends from anon, authenticated, public;
revoke all on table public.newsletter_send_recipients from anon, authenticated, public;
revoke all on table public.newsletter_webhook_events from anon, authenticated, public;

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_newsletter_touch on public.newsletter_subscribers;
create trigger trg_newsletter_touch
  before update on public.newsletter_subscribers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-subscribe on profile creation.
--
-- Why a trigger, not the client: OAuth (Google, Apple) never hits a signup
-- form hook unless you duplicate it on every auth route, and anyone whose
-- app backgrounds between account creation and a network call is silently
-- missed. A trigger on profiles catches every account, once, atomically.
--
-- ON CONFLICT WHERE status = 'subscribed' is the whole point.
-- Do not simplify this to `do update set status = 'subscribed'`.
-- An existing unsubscribed / bounced / complained row must be left untouched.
-- Creating an account does not undo an opt-out. That one-word change is a
-- CAN-SPAM violation (failure to honor opt-out).
-- ---------------------------------------------------------------------------
create or replace function public.auto_subscribe_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or new.email = '' then
    return new;
  end if;

  insert into public.newsletter_subscribers (email, user_id, status, source)
  values (new.email, new.id, 'subscribed', 'app_signup')
  on conflict (email) do update
    set user_id = excluded.user_id       -- link the row to the account
    where public.newsletter_subscribers.status = 'subscribed';
    -- ^ The WHERE clause is the whole point. An existing row that is
    --   unsubscribed, bounced or complained is left completely untouched.
    --   Creating an account does not undo an opt-out.

  return new;
exception
  when others then
    -- Never block account creation if newsletter insert fails.
    raise warning 'auto_subscribe_new_profile failed: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.auto_subscribe_new_profile() from public, anon, authenticated;
grant execute on function public.auto_subscribe_new_profile() to postgres, service_role;

drop trigger if exists trg_auto_subscribe_profile on public.profiles;
create trigger trg_auto_subscribe_profile
  after insert on public.profiles
  for each row execute function public.auto_subscribe_new_profile();

-- ---------------------------------------------------------------------------
-- OPTIONAL cutover backfill.
-- Existing daily_brief_opt_in users already receive the SendGrid brief.
-- Run this when you point delivery at newsletter_subscribers so the two
-- lists do not drift. Safe for people who were already opted in.
-- ---------------------------------------------------------------------------
-- insert into public.newsletter_subscribers (email, user_id, status, source)
-- select p.email, p.id, 'subscribed', 'app_signup'
-- from public.profiles p
-- inner join auth.users u on u.id = p.id
-- where p.daily_brief_opt_in = true
--   and p.email is not null
--   and trim(p.email) <> ''
--   and u.email_confirmed_at is not null
-- on conflict (email) do update
--   set user_id = excluded.user_id
--   where public.newsletter_subscribers.status = 'subscribed';
