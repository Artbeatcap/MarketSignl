-- Daily / Morning Brief: artifact store, opt-in mirroring weekly, recipient helper

create table if not exists public.daily_brief_content (
  id uuid primary key default gen_random_uuid(),
  date_label text not null,
  generated_at timestamptz,
  data_stale boolean not null default false,
  artifact jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_daily_brief_received_at
  on public.daily_brief_content (received_at desc);

alter table public.profiles
  add column if not exists daily_brief_opt_in boolean not null default true;

-- Mirror current weekly opt-in so daily recipients start as the same cohort
update public.profiles
set daily_brief_opt_in = weekly_brief_opt_in
where daily_brief_opt_in is distinct from weekly_brief_opt_in;

create or replace function public.get_daily_brief_recipients()
returns table (id uuid, email text, unsubscribe_token uuid)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.unsubscribe_token
  from public.profiles p
  inner join auth.users u on u.id = p.id
  where p.daily_brief_opt_in = true
    and p.email is not null
    and trim(p.email) <> ''
    and u.email_confirmed_at is not null;
$$;

revoke all on function public.get_daily_brief_recipients() from public;
grant execute on function public.get_daily_brief_recipients() to service_role;

alter table public.daily_brief_content enable row level security;
