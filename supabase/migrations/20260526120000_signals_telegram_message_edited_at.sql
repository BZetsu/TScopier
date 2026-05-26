-- Track when a Telegram channel post was edited and re-parsed (SL/TP refresh path).
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS telegram_message_edited_at timestamptz;

COMMENT ON COLUMN public.signals.telegram_message_edited_at IS
  'Wall time the listener last applied a Telegram message edit to this signal row.';
