-- Per-channel live event timestamp (distinct from poll/catch-up last_seen_at).

ALTER TABLE telegram_channels
  ADD COLUMN IF NOT EXISTS last_live_at timestamptz;

COMMENT ON COLUMN telegram_channels.last_live_at IS
  'When the listener last received a live NewMessage for this channel row.';
