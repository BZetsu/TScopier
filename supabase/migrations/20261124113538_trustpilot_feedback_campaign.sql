-- Trustpilot feedback campaign: once-ever ask to rate UniCopier.
-- Eligible when the earliest of these has passed:
--   • Advanced trial ended (trial_ends_at)
--   • 5 days after Basic purchase (subscriptions.created_at for plan=basic)
--   • 5 days after account join (auth.users.created_at)
-- Also refresh daily-cap lists on sibling recipient RPCs to include this type.

DO $do$
BEGIN
  IF to_regclass('public.email_campaign_log') IS NULL
    OR to_regclass('public.email_unsubscribes') IS NULL
    OR to_regclass('public.subscriptions') IS NULL
    OR to_regclass('public.user_profiles') IS NULL
    OR to_regclass('auth.users') IS NULL
  THEN
    RAISE NOTICE 'campaign email objects absent — skipping trustpilot feedback campaign';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_trustpilot_feedback_recipients()
 RETURNS TABLE(user_id uuid, email text, display_name text, first_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT
  up.user_id,
  au.email::text,
  up.display_name,
  up.first_name
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
LEFT JOIN subscriptions s ON s.user_id = up.user_id
WHERE
  au.email IS NOT NULL
  AND btrim(au.email::text) <> ''
  -- Earliest milestone: after trial, or 5d after Basic purchase, or 5d after join
  AND LEAST(
    COALESCE(s.trial_ends_at, 'infinity'::timestamptz),
    CASE
      WHEN s.plan = 'basic' THEN s.created_at + interval '5 days'
      ELSE 'infinity'::timestamptz
    END,
    au.created_at + interval '5 days'
  ) <= now()
  AND NOT EXISTS (
    SELECT 1 FROM email_unsubscribes eu
    WHERE eu.user_id = up.user_id
  )
  -- Once ever
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl
    WHERE ecl.user_id = up.user_id
    AND ecl.campaign_type = 'trustpilot_feedback'
  )
  -- One campaign email per user per 24 hours (cross-campaign cap)
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl_day
    WHERE ecl_day.user_id = up.user_id
    AND ecl_day.campaign_type IN (
      'no_subscription_nudge',
      'trial_expired',
      'invoice_due',
      'broadcast',
      'trustpilot_feedback'
    )
    AND ecl_day.sent_at > now() - interval '24 hours'
  )
ORDER BY
  LEAST(
    COALESCE(s.trial_ends_at, 'infinity'::timestamptz),
    CASE
      WHEN s.plan = 'basic' THEN s.created_at + interval '5 days'
      ELSE 'infinity'::timestamptz
    END,
    au.created_at + interval '5 days'
  ) ASC
LIMIT 50;
$function$;
  $fn$;

  -- Keep sibling RPCs' daily caps aware of the new campaign type.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_no_subscription_nudge_recipients()
 RETURNS TABLE(user_id uuid, email text, display_name text, first_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT
  up.user_id,
  au.email::text,
  up.display_name,
  up.first_name
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE
  up.onboarding_completed_at IS NOT NULL
  AND up.onboarding_completed_at <= now() - interval '1 hour'
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = up.user_id
    AND s.status IN ('active', 'trialing')
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_unsubscribes eu
    WHERE eu.user_id = up.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl
    WHERE ecl.user_id = up.user_id
    AND ecl.campaign_type = 'no_subscription_nudge'
    AND ecl.sent_at > now() - interval '3 days'
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl_day
    WHERE ecl_day.user_id = up.user_id
    AND ecl_day.campaign_type IN (
      'no_subscription_nudge',
      'trial_expired',
      'invoice_due',
      'broadcast',
      'trustpilot_feedback'
    )
    AND ecl_day.sent_at > now() - interval '24 hours'
  )
LIMIT 50;
$function$;
  $fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_trial_expired_recipients()
 RETURNS TABLE(user_id uuid, email text, display_name text, first_name text, stripe_customer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT
  up.user_id,
  au.email::text,
  up.display_name,
  up.first_name,
  s.stripe_customer_id
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
JOIN subscriptions s ON s.user_id = up.user_id
WHERE
  (
    s.status = 'canceled'
    OR (s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now() AND s.status NOT IN ('active', 'trialing'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_unsubscribes eu
    WHERE eu.user_id = up.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl
    WHERE ecl.user_id = up.user_id
    AND ecl.campaign_type = 'trial_expired'
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl_day
    WHERE ecl_day.user_id = up.user_id
    AND ecl_day.campaign_type IN (
      'no_subscription_nudge',
      'trial_expired',
      'invoice_due',
      'broadcast',
      'trustpilot_feedback'
    )
    AND ecl_day.sent_at > now() - interval '24 hours'
  )
LIMIT 50;
$function$;
  $fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_invoice_due_recipients()
 RETURNS TABLE(user_id uuid, email text, display_name text, first_name text, stripe_customer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT
  up.user_id,
  au.email::text,
  up.display_name,
  up.first_name,
  s.stripe_customer_id
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
JOIN subscriptions s ON s.user_id = up.user_id
WHERE
  s.status = 'past_due'
  AND s.stripe_customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM email_unsubscribes eu
    WHERE eu.user_id = up.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl
    WHERE ecl.user_id = up.user_id
    AND ecl.campaign_type = 'invoice_due'
    AND ecl.sent_at > now() - interval '3 days'
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_campaign_log ecl_day
    WHERE ecl_day.user_id = up.user_id
    AND ecl_day.campaign_type IN (
      'no_subscription_nudge',
      'trial_expired',
      'invoice_due',
      'broadcast',
      'trustpilot_feedback'
    )
    AND ecl_day.sent_at > now() - interval '24 hours'
  )
LIMIT 20;
$function$;
  $fn$;

  GRANT EXECUTE ON FUNCTION public.get_trustpilot_feedback_recipients() TO service_role;
END
$do$;
