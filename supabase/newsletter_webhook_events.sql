-- Additive: webhook event dedupe for SendGrid Event Webhook.
-- Run this if newsletter_migration.sql was already applied without this table.
-- Safe to re-run.

create table if not exists public.newsletter_webhook_events (
  sg_event_id text primary key,
  event text not null,
  email text,
  received_at timestamptz not null default now()
);

alter table public.newsletter_webhook_events enable row level security;
revoke all on table public.newsletter_webhook_events from anon, authenticated, public;
