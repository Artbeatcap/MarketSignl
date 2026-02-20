-- Add RevenueCat-specific columns to subscriptions and allow grace_period status.
-- Run in Supabase SQL Editor or via supabase db push.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'purchase_date') THEN
    ALTER TABLE public.subscriptions ADD COLUMN purchase_date TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'original_purchase_date') THEN
    ALTER TABLE public.subscriptions ADD COLUMN original_purchase_date TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'store') THEN
    ALTER TABLE public.subscriptions ADD COLUMN store TEXT CHECK (store IN ('play_store', 'app_store'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'is_sandbox') THEN
    ALTER TABLE public.subscriptions ADD COLUMN is_sandbox BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'cancellation_date') THEN
    ALTER TABLE public.subscriptions ADD COLUMN cancellation_date TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'billing_issues_detected_at') THEN
    ALTER TABLE public.subscriptions ADD COLUMN billing_issues_detected_at TIMESTAMPTZ;
  END IF;
END $$;

-- Allow grace_period in status (drop and re-add check)
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'cancelled', 'expired', 'grace_period', 'free'));

-- Index for RevenueCat lookups by app_user_id (stored in revenuecat_subscriber_id)
CREATE INDEX IF NOT EXISTS idx_subscriptions_revenuecat_subscriber
  ON public.subscriptions(revenuecat_subscriber_id) WHERE revenuecat_subscriber_id IS NOT NULL;
