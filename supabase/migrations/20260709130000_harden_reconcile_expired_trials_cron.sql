/*
  Harden reconcile-expired-trials cron: skip when app.settings are unset
  (same pattern as signal-reconcile-sweep).
*/

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
