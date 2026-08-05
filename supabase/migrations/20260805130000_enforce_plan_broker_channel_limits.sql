-- Enforce Basic/Advanced broker + Telegram channel limits at the database.
-- App/edge checks are advisory; RLS alone only verifies auth.uid() = user_id.

CREATE OR REPLACE FUNCTION public.user_is_admin_for_plan_limits(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN up.is_admin IS NOT TRUE THEN false
        WHEN up.admin_until IS NULL THEN true
        WHEN up.admin_until > now() THEN true
        ELSE false
      END
      FROM public.user_profiles up
      WHERE up.user_id = p_user_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_effective_plan_for_limits(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.status = 'active' THEN s.plan
    WHEN s.status = 'trialing'
      AND (s.trial_ends_at IS NULL OR s.trial_ends_at > now()) THEN s.plan
    ELSE NULL
  END
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_broker_account_limit(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.user_effective_plan_for_limits(p_user_id) = 'advanced' THEN
      5 + GREATEST(0, LEAST(95, COALESCE((
        SELECT s.extra_accounts
        FROM public.subscriptions s
        WHERE s.user_id = p_user_id
        LIMIT 1
      ), 0)))
    WHEN public.user_effective_plan_for_limits(p_user_id) = 'basic' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.user_telegram_channel_limit(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- NULL => unlimited (Advanced). 0 => no active subscription.
  SELECT CASE
    WHEN public.user_effective_plan_for_limits(p_user_id) = 'advanced' THEN NULL
    WHEN public.user_effective_plan_for_limits(p_user_id) = 'basic' THEN 5
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_broker_account_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) AND COALESCE(NEW.is_active, false) THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.is_active, false) THEN
    RETURN NEW;
  END IF;
  IF public.user_is_admin_for_plan_limits(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  v_limit := public.user_broker_account_limit(NEW.user_id);
  IF v_limit <= 0 THEN
    RAISE EXCEPTION 'subscription_required: An active subscription is required to connect broker accounts.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.broker_accounts ba
  WHERE ba.user_id = NEW.user_id
    AND ba.is_active = true
    AND (TG_OP = 'INSERT' OR ba.id <> NEW.id);

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'broker_account_limit: Plan allows % broker account(s). Upgrade or deactivate another account first.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_telegram_channel_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) AND COALESCE(NEW.is_active, false) THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.is_active, false) THEN
    RETURN NEW;
  END IF;
  IF public.user_is_admin_for_plan_limits(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  v_limit := public.user_telegram_channel_limit(NEW.user_id);
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_limit <= 0 THEN
    RAISE EXCEPTION 'subscription_required: An active subscription is required to add Telegram channels.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.telegram_channels tc
  WHERE tc.user_id = NEW.user_id
    AND tc.is_active = true
    AND (TG_OP = 'INSERT' OR tc.id <> NEW.id);

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'channel_limit: Basic plan includes % Telegram channels. Upgrade to Advanced for unlimited channels.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broker_accounts_plan_limit_trg ON public.broker_accounts;
CREATE TRIGGER broker_accounts_plan_limit_trg
  BEFORE INSERT OR UPDATE OF is_active ON public.broker_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_broker_account_plan_limit();

DROP TRIGGER IF EXISTS telegram_channels_plan_limit_trg ON public.telegram_channels;
CREATE TRIGGER telegram_channels_plan_limit_trg
  BEFORE INSERT OR UPDATE OF is_active ON public.telegram_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_telegram_channel_plan_limit();

-- Close direct client inserts; brokers already go through fxsocket-broker (service role).
-- Telegram channel creates go through upsert-telegram-channel edge function.
DROP POLICY IF EXISTS "Users can insert own broker accounts" ON public.broker_accounts;
DROP POLICY IF EXISTS "Users can insert own telegram channels" ON public.telegram_channels;

COMMENT ON FUNCTION public.enforce_broker_account_plan_limit() IS
  'Rejects INSERT/reactivation of broker_accounts past plan maxBrokerAccounts.';
COMMENT ON FUNCTION public.enforce_telegram_channel_plan_limit() IS
  'Rejects INSERT/reactivation of telegram_channels past Basic maxTelegramChannels (5).';
