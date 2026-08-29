-- Run in the Supabase SQL Editor AFTER newsletter_migration.sql.
-- Encodes non-negotiable #1: an unsubscribed row is not revived by profile creation.

do $$
declare
  test_user_id uuid := gen_random_uuid();
  test_email citext := ('unsub-trigger-' || substr(test_user_id::text, 1, 8) || '@example.com')::citext;
  found_status public.subscriber_status;
  found_user uuid;
begin
  insert into public.newsletter_subscribers (email, status, source)
  values (test_email, 'unsubscribed', 'landing_hero');

  -- Simulate the trigger body against that email (same ON CONFLICT WHERE).
  insert into public.newsletter_subscribers (email, user_id, status, source)
  values (test_email, test_user_id, 'subscribed', 'app_signup')
  on conflict (email) do update
    set user_id = excluded.user_id
    where public.newsletter_subscribers.status = 'subscribed';

  select status, user_id into found_status, found_user
  from public.newsletter_subscribers
  where email = test_email;

  if found_status is distinct from 'unsubscribed' then
    raise exception 'FAIL: unsubscribed row was revived (status=%)', found_status;
  end if;
  if found_user is not null then
    raise exception 'FAIL: unsubscribed row had user_id linked';
  end if;

  delete from public.newsletter_subscribers where email = test_email;
  raise notice 'PASS: unsubscribed row was not revived by signup conflict';
end;
$$;

do $$
declare
  test_user_id uuid := gen_random_uuid();
  test_email citext := ('complain-trigger-' || substr(test_user_id::text, 1, 8) || '@example.com')::citext;
  found_status public.subscriber_status;
begin
  insert into public.newsletter_subscribers (email, status, source)
  values (test_email, 'complained', 'landing_hero');

  insert into public.newsletter_subscribers (email, user_id, status, source)
  values (test_email, test_user_id, 'subscribed', 'app_signup')
  on conflict (email) do update
    set user_id = excluded.user_id
    where public.newsletter_subscribers.status = 'subscribed';

  select status into found_status
  from public.newsletter_subscribers
  where email = test_email;

  if found_status is distinct from 'complained' then
    raise exception 'FAIL: complained row was revived (status=%)', found_status;
  end if;

  delete from public.newsletter_subscribers where email = test_email;
  raise notice 'PASS: complained row was not revived by signup conflict';
end;
$$;
