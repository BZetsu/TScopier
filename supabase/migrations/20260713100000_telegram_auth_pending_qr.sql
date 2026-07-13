-- QR login: auth_method discriminator and nullable phone fields for QR pending rows.

ALTER TABLE public.telegram_auth_pending
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'phone';

ALTER TABLE public.telegram_auth_pending
  ADD COLUMN IF NOT EXISTS qr_expires_at timestamptz;

ALTER TABLE public.telegram_auth_pending
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.telegram_auth_pending
  ALTER COLUMN phone_code_hash DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telegram_auth_pending_auth_method_check'
  ) THEN
    ALTER TABLE public.telegram_auth_pending
      ADD CONSTRAINT telegram_auth_pending_auth_method_check
      CHECK (auth_method IN ('phone', 'qr'));
  END IF;
END $$;
