-- Allow ephemeral MTProto holds (backtest / history sync on a dedicated worker)
-- so the live listener can pause via the existing telegram_auth_pending Realtime path.
ALTER TABLE public.telegram_auth_pending
  DROP CONSTRAINT IF EXISTS telegram_auth_pending_auth_method_check;

ALTER TABLE public.telegram_auth_pending
  ADD CONSTRAINT telegram_auth_pending_auth_method_check
  CHECK (auth_method IN ('phone', 'qr', 'mtproto_hold'));

COMMENT ON COLUMN public.telegram_auth_pending.auth_method IS
  'phone | qr | mtproto_hold (temporary pause of live listener for ephemeral Telegram use)';
