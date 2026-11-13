-- Morning brief in the app: the gated send is stored, opens are logged,
-- and each profile can turn the brief push off without turning off price alerts.
-- Idempotent. RLS on, zero policies: the service role bypasses RLS; anon and
-- authenticated are revoked so the Data API cannot read the brief store.

create table if not exists public.daily_brief_published (
  id              bigserial primary key,
  as_of           date        not null,
  edition         text        not null default 'morning' check (edition in ('morning', 'close')),
  content         jsonb       not null,
  complete        boolean     not null,
  missing         jsonb,
  published_at    timestamptz not null default now(),
  push_claimed_at timestamptz,
  push_summary    jsonb,
  unique (as_of, edition)
);

alter table public.profiles
  add column if not exists brief_push_enabled boolean not null default true;

create table if not exists public.brief_opens (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  as_of      date not null,
  source     text not null check (source in ('push', 'email', 'tab', 'link')),
  platform   text,
  created_at timestamptz not null default now()
);

create index if not exists idx_brief_opens_as_of on public.brief_opens (as_of, source);

alter table public.daily_brief_published enable row level security;
alter table public.brief_opens enable row level security;

revoke all on table public.daily_brief_published from anon, authenticated, public;
revoke all on table public.brief_opens from anon, authenticated, public;

alter type public.subscriber_source add value if not exists 'brief';
