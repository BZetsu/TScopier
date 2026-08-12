/*
  IP-based rate limits for auth-related edge functions (verification email, password reset).
  claim_auth_abuse_slot() is called with a hashed client IP before Resend is invoked.
*/

CREATE TABLE IF NOT EXISTS public.auth_abuse_rate_limits (
  action_key text NOT NULL,
  ip_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  window_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_key, ip_hash)
);

COMMENT ON TABLE public.auth_abuse_rate_limits IS
  'Rolling hourly caps per action + hashed client IP for auth email abuse prevention.';

ALTER TABLE public.auth_abuse_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_abuse_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_abuse_rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.auth_abuse_rate_limits TO service_role;

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
  action_key text := lower(btrim(COALESCE(p_action, '')));
  ip_hash text := lower(btrim(COALESCE(p_ip_hash, '')));
  now_ts timestamptz := now();
  row_rec public.auth_abuse_rate_limits%ROWTYPE;
  retry_after integer;
  max_per_hour integer := GREATEST(1, COALESCE(p_max_per_hour, 10));
BEGIN
  IF action_key = '' OR ip_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_key');
  END IF;

  INSERT INTO public.auth_abuse_rate_limits (
    action_key,
    ip_hash,
    window_started_at,
    window_count
  )
  VALUES (action_key, ip_hash, now_ts, 0)
  ON CONFLICT (action_key, ip_hash) DO NOTHING;

  SELECT *
  INTO row_rec
  FROM public.auth_abuse_rate_limits
  WHERE auth_abuse_rate_limits.action_key = claim_auth_abuse_slot.action_key
    AND auth_abuse_rate_limits.ip_hash = claim_auth_abuse_slot.ip_hash
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
  WHERE auth_abuse_rate_limits.action_key = claim_auth_abuse_slot.action_key
    AND auth_abuse_rate_limits.ip_hash = claim_auth_abuse_slot.ip_hash;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_auth_abuse_slot(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_auth_abuse_slot(text, text, integer) TO service_role;

COMMENT ON FUNCTION public.claim_auth_abuse_slot(text, text, integer) IS
  'Atomically claims an auth-abuse slot per action + hashed IP (default 10/hour).';
