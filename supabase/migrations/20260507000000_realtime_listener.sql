/*
  # Realtime listener support

  Adds the schema bits the worker needs to:
  - resume from a known point per channel after a reconnect/restart
  - safely insert the same telegram_message_id from both live events and
    catch-up replay without creating duplicates
  - receive instant notifications when a user picks a new channel

  ## Changes
  - telegram_channels: add `last_seen_message_id` (text, nullable) and
    `last_seen_at` (timestamptz, nullable). Updated on every signal insert.
  - signals: add a partial unique index on (user_id, telegram_message_id)
    so upsert-with-ignore is the dedupe primitive used by both code paths.
  - publication: include telegram_channels in the supabase_realtime
    publication so the worker's postgres_changes subscription receives
    INSERT/UPDATE/DELETE events for instant subscription rebinds.
*/

ALTER TABLE telegram_channels
  ADD COLUMN IF NOT EXISTS last_seen_message_id bigint,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS signals_user_msg_unique
  ON signals (user_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'telegram_channels'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE telegram_channels';
  END IF;
END$$;
