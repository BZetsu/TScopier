-- Audit trail for listener-layer events (no silent drops on monitored channels).

CREATE TABLE IF NOT EXISTS listener_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_row_id uuid REFERENCES telegram_channels(id) ON DELETE SET NULL,
  telegram_message_id text,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listener_events_user_created_idx
  ON listener_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS listener_events_channel_created_idx
  ON listener_events (channel_row_id, created_at DESC)
  WHERE channel_row_id IS NOT NULL;

ALTER TABLE listener_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own listener_events"
  ON listener_events FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE listener_events IS
  'Listener audit: unmapped_channel, poll_error, peer_resolve_failed, etc.';
