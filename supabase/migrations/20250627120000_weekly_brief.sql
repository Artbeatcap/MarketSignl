-- Weekly Brief: artifact store, opt-in/unsubscribe on profiles, recipient helper

create table if not exists public.weekly_brief_content (
  id uuid primary key default gen_random_uuid(),
  week_label text not null,
  generated_at timestamptz,
  data_stale boolean not null default false,
  artifact jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_weekly_brief_received_at
  on public.weekly_brief_content (received_at desc);

alter table public.profiles
  add column if not exists weekly_brief_opt_in boolean not null default true;

alter table public.profiles
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- Backfill unsubscribe_token for any rows that might have null (pre-default)
update public.profiles
set unsubscribe_token = gen_random_uuid()
where unsubscribe_token is null;

create or replace function public.get_weekly_brief_recipients()
returns table (id uuid, email text, unsubscribe_token uuid)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.unsubscribe_token
  from public.profiles p
  inner join auth.users u on u.id = p.id
  where p.weekly_brief_opt_in = true
    and p.email is not null
    and trim(p.email) <> ''
    and u.email_confirmed_at is not null;
$$;

revoke all on function public.get_weekly_brief_recipients() from public;
grant execute on function public.get_weekly_brief_recipients() to service_role;

alter table public.weekly_brief_content enable row level security;
