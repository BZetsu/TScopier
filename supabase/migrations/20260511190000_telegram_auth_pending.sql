-- Persists Telegram login challenge so verify_code can recover after worker
-- restart or when another replica handled send_code (in-memory Map is per process).

CREATE TABLE IF NOT EXISTS public.telegram_auth_pending (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  phone text NOT NULL,
  phone_code_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS telegram_auth_pending_expires_at_idx
  ON public.telegram_auth_pending (expires_at);

ALTER TABLE public.telegram_auth_pending ENABLE ROW LEVEL SECURITY;
