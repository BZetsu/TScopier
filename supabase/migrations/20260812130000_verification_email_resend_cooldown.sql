/*
  Rate-limit branded verification email sends to prevent resend abuse.
  claim_verification_email_send() is called by the send-verification-email
  edge function (service_role) before Resend is invoked.
*/

CREATE TABLE IF NOT EXISTS public.email_verification_sends (
  email_normalized text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  window_send_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_verification_sends IS
  'Tracks verification email sends for per-address cooldown and hourly caps.';

ALTER TABLE public.email_verification_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_verification_sends FROM PUBLIC;
REVOKE ALL ON TABLE public.email_verification_sends FROM anon, authenticated;
GRANT ALL ON TABLE public.email_verification_sends TO service_role;

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
BEGIN
  IF norm = '' OR position('@' in norm) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
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

REVOKE ALL ON FUNCTION public.claim_verification_email_send(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_verification_email_send(text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_verification_email_send(text, integer, integer) IS
  'Atomically claims a verification-email send slot (60s cooldown, 5/hour by default).';
