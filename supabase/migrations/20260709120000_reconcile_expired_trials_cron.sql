/*
  # TScopier - schedule reconcile-expired-trials edge function

  Hourly: pull Stripe state for subscriptions stuck as trialing after trial_ends_at.
  Also pause copier / drop leases for expired trials still marked trialing (defense in depth
  until Stripe sync lands).
*/

-- Immediate access cut for expired trials still marked trialing
UPDATE public.user_profiles p
SET copier_paused = true
FROM public.subscriptions s
WHERE s.user_id = p.user_id
  AND s.status = 'trialing'
  AND s.trial_ends_at IS NOT NULL
  AND s.trial_ends_at < now()
  AND p.copier_paused = false
  AND p.is_admin = false;

DELETE FROM public.worker_session_leases l
USING public.subscriptions s
WHERE l.user_id = s.user_id
  AND s.status = 'trialing'
  AND s.trial_ends_at IS NOT NULL
  AND s.trial_ends_at < now();

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'reconcile-expired-trials';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'reconcile-expired-trials',
  '15 * * * *',
  $cmd$
DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
BEGIN
  IF v_url IS NULL OR v_key IS NULL OR length(trim(v_url)) = 0 OR length(trim(v_key)) = 0 THEN
    RAISE NOTICE 'Skipping reconcile-expired-trials: missing app.settings.supabase_url or app.settings.service_role_key';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/reconcile-expired-trials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END
$$;
$cmd$
);
