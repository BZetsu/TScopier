/*
  Re-enable signal-reconcile-sweep with vault-backed credentials.

  Prod had the job inactive and app.settings.supabase_url / service_role_key
  unset, so even an active job would no-op. Prefer:
    1) app.settings (local / some staging)
    2) vault secrets supabase_url + service_role_key
  Also harden reconcile-expired-trials the same way (it was silently skipping).

  Prerequisite (once per project): vault secret `supabase_url` must be the
  API host (https://<ref>.supabase.co), NOT the custom SSO host. Example:
    select vault.create_secret(
      'https://<project-ref>.supabase.co',
      'supabase_url',
      'API URL for pg_cron edge function invokes'
    );
  `service_role_key` must also exist in vault (same secret campaigns cron uses).
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'signal-reconcile-sweep';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'reconcile-expired-trials';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'signal-reconcile-sweep',
  '*/2 * * * *',
  $cmd$
DO $body$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := nullif(trim(coalesce(current_setting('app.settings.supabase_url', true), '')), '');
  v_key := nullif(trim(coalesce(current_setting('app.settings.service_role_key', true), '')), '');

  IF v_url IS NULL OR v_url NOT LIKE '%.supabase.co%' THEN
    SELECT nullif(trim(decrypted_secret), '') INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
      AND decrypted_secret LIKE '%.supabase.co%'
    LIMIT 1;
  END IF;

  IF v_key IS NULL THEN
    SELECT nullif(trim(decrypted_secret), '') INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  END IF;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Skipping signal-reconcile-sweep: missing supabase URL or service_role_key (app.settings / vault)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/signal-reconcile-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END
$body$;
$cmd$
);

SELECT cron.schedule(
  'reconcile-expired-trials',
  '15 * * * *',
  $cmd$
DO $body$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := nullif(trim(coalesce(current_setting('app.settings.supabase_url', true), '')), '');
  v_key := nullif(trim(coalesce(current_setting('app.settings.service_role_key', true), '')), '');

  IF v_url IS NULL OR v_url NOT LIKE '%.supabase.co%' THEN
    SELECT nullif(trim(decrypted_secret), '') INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
      AND decrypted_secret LIKE '%.supabase.co%'
    LIMIT 1;
  END IF;

  IF v_key IS NULL THEN
    SELECT nullif(trim(decrypted_secret), '') INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  END IF;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Skipping reconcile-expired-trials: missing supabase URL or service_role_key (app.settings / vault)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/reconcile-expired-trials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END
$body$;
$cmd$
);
