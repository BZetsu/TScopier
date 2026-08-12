/*
  Raise global verification-email cap from 20 → 100 / hour.

  Context: emergency 20/hour after Resend flood blocked legit signups (e.g.
  ivyfiv@gmail.com) when the window was still full. Turnstile + IP limits
  (3/hour) + email policy are the primary bot controls; global remains a
  backstop against IP rotation, not the main throttle.

  Also: claim_verification_email_send is the ONLY writer to
  verification_email_global for send-verification-email (edge must not also
  call enforceGlobalRateLimit on the same bucket — that double-counted).
*/

CREATE OR REPLACE FUNCTION public.claim_verification_email_send(
  p_email text,
  p_cooldown_seconds integer DEFAULT 60,
  p_max_per_hour integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm text := lower(btrim(COALESCE(p_email, '')));
  now_ts timestamptz := now();
  row_rec public.email_verification_sends%ROWTYPE;
  retry_after integer;
  cooldown_secs integer := GREATEST(1, COALESCE(p_cooldown_seconds, 60));
  max_per_hour integer := GREATEST(1, COALESCE(p_max_per_hour, 5));
  global_max integer := 100;
  global_claim jsonb;
BEGIN
  IF norm = '' OR position('@' in norm) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  -- Absolute cross-address cap (stops unique-email bot floods)
  global_claim := public.claim_auth_abuse_slot(
    'verification_email_global',
    'global',
    global_max
  );
  IF COALESCE((global_claim->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', GREATEST(1, COALESCE((global_claim->>'retry_after_seconds')::integer, 3600))
    );
  END IF;

  INSERT INTO public.email_verification_sends (
    email_normalized,
    last_sent_at,
    window_started_at,
    window_send_count
  )
  VALUES (norm, 'epoch'::timestamptz, now_ts, 0)
  ON CONFLICT (email_normalized) DO NOTHING;

  SELECT *
  INTO row_rec
  FROM public.email_verification_sends
  WHERE email_normalized = norm
  FOR UPDATE;

  IF row_rec.window_started_at <= now_ts - interval '1 hour' THEN
    row_rec.window_started_at := now_ts;
    row_rec.window_send_count := 0;
  END IF;

  IF row_rec.window_send_count >= max_per_hour THEN
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

  IF row_rec.last_sent_at > now_ts - make_interval(secs => cooldown_secs) THEN
    retry_after := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (
        row_rec.last_sent_at + make_interval(secs => cooldown_secs) - now_ts
      )))::integer
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'cooldown',
      'retry_after_seconds', retry_after
    );
  END IF;

  UPDATE public.email_verification_sends
  SET
    last_sent_at = now_ts,
    window_started_at = row_rec.window_started_at,
    window_send_count = row_rec.window_send_count + 1,
    updated_at = now_ts
  WHERE email_normalized = norm;

  RETURN jsonb_build_object(
    'ok', true,
    'cooldown_seconds', cooldown_secs
  );
END;
$$;

COMMENT ON FUNCTION public.claim_verification_email_send(text, integer, integer) IS
  'Claims a verification-email send slot: global 100/hour + per-email 60s cooldown and 5/hour.';
