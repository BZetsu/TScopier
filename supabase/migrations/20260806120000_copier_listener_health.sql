-- Server-authoritative copier health state. Worker/service-role writes only;
-- authenticated users may read their own safe status fields.

CREATE TABLE IF NOT EXISTS public.copier_listener_health (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  role text,
  shard_id integer,
  shard_count integer,
  ownership_epoch timestamptz,
  lease_acquired_at timestamptz,
  telegram_account_status text NOT NULL DEFAULT 'unknown'
    CHECK (telegram_account_status IN ('not_linked', 'linked', 'invalid', 'reconnect_required', 'unknown')),
  listener_status text NOT NULL DEFAULT 'unknown'
    CHECK (listener_status IN ('connected', 'reconnecting', 'disconnected', 'failed', 'unknown')),
  copier_engine_status text NOT NULL DEFAULT 'unknown'
    CHECK (copier_engine_status IN ('operational', 'degraded', 'offline', 'stopped', 'unknown')),
  worker_ownership_status text NOT NULL DEFAULT 'unknown'
    CHECK (worker_ownership_status IN ('owned', 'lease_expiring', 'unowned', 'stale', 'unknown')),
  mtproto_connected boolean,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_probe_at timestamptz,
  last_successful_probe_at timestamptz,
  consecutive_probe_failures integer NOT NULL DEFAULT 0,
  reconnect_started_at timestamptz,
  reconnect_attempt integer NOT NULL DEFAULT 0,
  recovery_exhausted boolean NOT NULL DEFAULT false,
  shutdown_in_progress boolean NOT NULL DEFAULT false,
  freshness_threshold_ms integer NOT NULL DEFAULT 90000,
  health_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copier_listener_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copier_listener_health_user_read ON public.copier_listener_health;
CREATE POLICY copier_listener_health_user_read
  ON public.copier_listener_health
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS copier_listener_health_no_client_insert ON public.copier_listener_health;
CREATE POLICY copier_listener_health_no_client_insert
  ON public.copier_listener_health
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS copier_listener_health_no_client_update ON public.copier_listener_health;
CREATE POLICY copier_listener_health_no_client_update
  ON public.copier_listener_health
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS copier_listener_health_updated_idx
  ON public.copier_listener_health(updated_at DESC);

CREATE OR REPLACE FUNCTION public.upsert_copier_listener_health(
  p_user_id uuid,
  p_expected_worker_id text,
  p_ownership_epoch timestamptz,
  p_require_lease boolean,
  p_allow_without_lease boolean,
  p_role text,
  p_shard_id integer,
  p_shard_count integer,
  p_telegram_account_status text,
  p_listener_status text,
  p_copier_engine_status text,
  p_worker_ownership_status text,
  p_mtproto_connected boolean,
  p_last_connected_at timestamptz,
  p_last_disconnected_at timestamptz,
  p_last_probe_at timestamptz,
  p_last_successful_probe_at timestamptz,
  p_consecutive_probe_failures integer,
  p_reconnect_started_at timestamptz,
  p_reconnect_attempt integer,
  p_recovery_exhausted boolean,
  p_shutdown_in_progress boolean,
  p_health_reason text,
  p_freshness_threshold_ms integer,
  p_lease_acquired_at timestamptz,
  p_updated_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  current_lease_worker_id text;
  current_health record;
  has_current_owner boolean := false;
BEGIN
  SELECT worker_id
    INTO current_lease_worker_id
    FROM public.worker_session_leases
   WHERE user_id = p_user_id
     AND expires_at > now()
   ORDER BY expires_at DESC
   LIMIT 1;

  has_current_owner := current_lease_worker_id IS NOT NULL
    AND current_lease_worker_id = p_expected_worker_id;

  IF p_require_lease AND NOT has_current_owner THEN
    RETURN false;
  END IF;

  SELECT worker_id, ownership_epoch
    INTO current_health
    FROM public.copier_listener_health
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF current_lease_worker_id IS NOT NULL
     AND current_lease_worker_id <> p_expected_worker_id THEN
    RETURN false;
  END IF;

  IF current_health.worker_id IS NOT NULL
     AND current_health.ownership_epoch IS NOT NULL
     AND current_health.ownership_epoch <> p_ownership_epoch
     AND NOT has_current_owner THEN
    RETURN false;
  END IF;

  IF p_allow_without_lease
     AND current_lease_worker_id IS NOT NULL
     AND current_lease_worker_id <> p_expected_worker_id THEN
    RETURN false;
  END IF;

  INSERT INTO public.copier_listener_health (
    user_id,
    worker_id,
    role,
    shard_id,
    shard_count,
    ownership_epoch,
    lease_acquired_at,
    telegram_account_status,
    listener_status,
    copier_engine_status,
    worker_ownership_status,
    mtproto_connected,
    last_connected_at,
    last_disconnected_at,
    last_probe_at,
    last_successful_probe_at,
    consecutive_probe_failures,
    reconnect_started_at,
    reconnect_attempt,
    recovery_exhausted,
    shutdown_in_progress,
    freshness_threshold_ms,
    health_reason,
    updated_at
  ) VALUES (
    p_user_id,
    p_expected_worker_id,
    p_role,
    p_shard_id,
    p_shard_count,
    p_ownership_epoch,
    p_lease_acquired_at,
    p_telegram_account_status,
    p_listener_status,
    p_copier_engine_status,
    p_worker_ownership_status,
    p_mtproto_connected,
    p_last_connected_at,
    p_last_disconnected_at,
    p_last_probe_at,
    p_last_successful_probe_at,
    COALESCE(p_consecutive_probe_failures, 0),
    p_reconnect_started_at,
    COALESCE(p_reconnect_attempt, 0),
    COALESCE(p_recovery_exhausted, false),
    COALESCE(p_shutdown_in_progress, false),
    GREATEST(1000, COALESCE(p_freshness_threshold_ms, 90000)),
    p_health_reason,
    COALESCE(p_updated_at, now())
  )
  ON CONFLICT (user_id) DO UPDATE SET
    worker_id = EXCLUDED.worker_id,
    role = EXCLUDED.role,
    shard_id = EXCLUDED.shard_id,
    shard_count = EXCLUDED.shard_count,
    ownership_epoch = EXCLUDED.ownership_epoch,
    lease_acquired_at = EXCLUDED.lease_acquired_at,
    telegram_account_status = EXCLUDED.telegram_account_status,
    listener_status = EXCLUDED.listener_status,
    copier_engine_status = EXCLUDED.copier_engine_status,
    worker_ownership_status = EXCLUDED.worker_ownership_status,
    mtproto_connected = EXCLUDED.mtproto_connected,
    last_connected_at = EXCLUDED.last_connected_at,
    last_disconnected_at = EXCLUDED.last_disconnected_at,
    last_probe_at = EXCLUDED.last_probe_at,
    last_successful_probe_at = EXCLUDED.last_successful_probe_at,
    consecutive_probe_failures = EXCLUDED.consecutive_probe_failures,
    reconnect_started_at = EXCLUDED.reconnect_started_at,
    reconnect_attempt = EXCLUDED.reconnect_attempt,
    recovery_exhausted = EXCLUDED.recovery_exhausted,
    shutdown_in_progress = EXCLUDED.shutdown_in_progress,
    freshness_threshold_ms = EXCLUDED.freshness_threshold_ms,
    health_reason = EXCLUDED.health_reason,
    updated_at = EXCLUDED.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_copier_listener_health(
  uuid, text, timestamptz, boolean, boolean, text, integer, integer, text, text, text,
  text, boolean, timestamptz, timestamptz, timestamptz, timestamptz, integer,
  timestamptz, integer, boolean, boolean, text, integer, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_copier_listener_health(
  uuid, text, timestamptz, boolean, boolean, text, integer, integer, text, text, text,
  text, boolean, timestamptz, timestamptz, timestamptz, timestamptz, integer,
  timestamptz, integer, boolean, boolean, text, integer, timestamptz, timestamptz
) TO service_role;

COMMENT ON TABLE public.copier_listener_health IS
  'Safe listener health summary written by workers. Contains no Telegram session strings, credentials, phone numbers, broker responses, balances, or raw signal payloads.';
