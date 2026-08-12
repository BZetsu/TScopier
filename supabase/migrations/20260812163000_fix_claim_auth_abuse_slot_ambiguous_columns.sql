/*
  Fix claim_auth_abuse_slot: PL/pgSQL locals action_key/ip_hash shadowed table columns,
  causing "column reference action_key is ambiguous" on signup verification email.
*/

CREATE OR REPLACE FUNCTION public.claim_auth_abuse_slot(
  p_action text,
  p_ip_hash text,
  p_max_per_hour integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action_key text := lower(btrim(COALESCE(p_action, '')));
  v_ip_hash text := lower(btrim(COALESCE(p_ip_hash, '')));
  now_ts timestamptz := now();
  row_rec public.auth_abuse_rate_limits%ROWTYPE;
  retry_after integer;
  max_per_hour integer := GREATEST(1, COALESCE(p_max_per_hour, 10));
BEGIN
  IF v_action_key = '' OR v_ip_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_key');
  END IF;

  INSERT INTO public.auth_abuse_rate_limits (
    action_key,
    ip_hash,
    window_started_at,
    window_count
  )
  VALUES (v_action_key, v_ip_hash, now_ts, 0)
  ON CONFLICT (action_key, ip_hash) DO NOTHING;

  SELECT *
  INTO row_rec
  FROM public.auth_abuse_rate_limits
  WHERE auth_abuse_rate_limits.action_key = v_action_key
    AND auth_abuse_rate_limits.ip_hash = v_ip_hash
  FOR UPDATE;

  IF row_rec.window_started_at <= now_ts - interval '1 hour' THEN
    row_rec.window_started_at := now_ts;
    row_rec.window_count := 0;
  END IF;

  IF row_rec.window_count >= max_per_hour THEN
    retry_after := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (row_rec.window_started_at + interval '1 hour' - now_ts)))::integer
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', retry_after
    );
  END IF;

  UPDATE public.auth_abuse_rate_limits
  SET
    window_started_at = row_rec.window_started_at,
    window_count = row_rec.window_count + 1,
    updated_at = now_ts
  WHERE auth_abuse_rate_limits.action_key = v_action_key
    AND auth_abuse_rate_limits.ip_hash = v_ip_hash;

  RETURN jsonb_build_object('ok', true);
END;
$$;
