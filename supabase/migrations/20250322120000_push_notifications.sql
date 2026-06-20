-- Push notifications: tokens, price alerts, notification log, profile prefs.
-- Idempotent: safe to re-run.

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON public.push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON public.push_tokens(is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES public.chart_analyses(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  level_price NUMERIC(12, 4) NOT NULL,
  level_type TEXT NOT NULL CHECK (level_type IN ('support', 'resistance')),
  level_strength TEXT CHECK (level_strength IN ('strong', 'medium', 'weak')),
  level_description TEXT,
  direction TEXT NOT NULL DEFAULT 'either' CHECK (direction IN ('crosses_above', 'crosses_below', 'either')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'expired', 'disabled')),
  last_known_price NUMERIC(12, 4),
  last_checked_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ,
  triggered_price NUMERIC(12, 4),
  notification_sent BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON public.price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON public.price_alerts(status, expires_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON public.price_alerts(symbol)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_id UUID REFERENCES public.price_alerts(id) ON DELETE SET NULL,
  expo_push_token TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  expo_receipt_id TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'delivered', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON public.notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON public.notification_log(created_at DESC);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push tokens" ON public.push_tokens;
CREATE POLICY "Users can view own push tokens"
  ON public.push_tokens FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push tokens" ON public.push_tokens;
CREATE POLICY "Users can insert own push tokens"
  ON public.push_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own push tokens" ON public.push_tokens;
CREATE POLICY "Users can update own push tokens"
  ON public.push_tokens FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own push tokens" ON public.push_tokens;
CREATE POLICY "Users can delete own push tokens"
  ON public.push_tokens FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages push tokens" ON public.push_tokens;
CREATE POLICY "Service role manages push tokens"
  ON public.push_tokens FOR ALL USING (auth.role() = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view own alerts" ON public.price_alerts;
CREATE POLICY "Users can view own alerts"
  ON public.price_alerts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own alerts" ON public.price_alerts;
CREATE POLICY "Users can insert own alerts"
  ON public.price_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own alerts" ON public.price_alerts;
CREATE POLICY "Users can update own alerts"
  ON public.price_alerts FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own alerts" ON public.price_alerts;
CREATE POLICY "Users can delete own alerts"
  ON public.price_alerts FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages alerts" ON public.price_alerts;
CREATE POLICY "Service role manages alerts"
  ON public.price_alerts FOR ALL USING (auth.role() = 'service_role'::text);

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notification_log;
CREATE POLICY "Users can view own notifications"
  ON public.notification_log FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages notifications" ON public.notification_log;
CREATE POLICY "Service role manages notifications"
  ON public.notification_log FOR ALL USING (auth.role() = 'service_role'::text);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_active_alerts_by_symbol()
RETURNS TABLE (
  symbol TEXT,
  alert_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.symbol, COUNT(*)::BIGINT AS alert_count
  FROM public.price_alerts pa
  WHERE pa.status = 'active'
    AND pa.expires_at > NOW()
  GROUP BY pa.symbol
  ORDER BY alert_count DESC;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE public.price_alerts
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'active'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_push_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_tokens_updated_at ON public.push_tokens;
CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_push_tokens_updated_at();

DROP TRIGGER IF EXISTS price_alerts_updated_at ON public.price_alerts;
CREATE TRIGGER price_alerts_updated_at
  BEFORE UPDATE ON public.price_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_push_tokens_updated_at();

-- ============================================================================
-- PROFILE NOTIFICATION PREFERENCES
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'push_notifications_enabled'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'alert_sound_enabled'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN alert_sound_enabled BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'quiet_hours_start'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_start TIME;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'quiet_hours_end'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_end TIME;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN timezone TEXT DEFAULT 'America/New_York';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_stale_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_alerts_by_symbol() TO service_role;
