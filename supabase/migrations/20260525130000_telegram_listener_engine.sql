-- Per-user listener engine for gramjs → Telethon cutover.

ALTER TABLE telegram_sessions
  ADD COLUMN IF NOT EXISTS listener_engine text NOT NULL DEFAULT 'gramjs';

ALTER TABLE telegram_sessions
  DROP CONSTRAINT IF EXISTS telegram_sessions_listener_engine_check;

ALTER TABLE telegram_sessions
  ADD CONSTRAINT telegram_sessions_listener_engine_check
  CHECK (listener_engine IN ('gramjs', 'telethon'));

COMMENT ON COLUMN telegram_sessions.listener_engine IS
  'Which listener service owns MTProto: gramjs (TS worker) or telethon (Python).';
