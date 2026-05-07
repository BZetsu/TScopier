/*
  # Ensure upsert target exists for telegram channel saves

  UI code saves connected Telegram channels with:
    .upsert(..., { onConflict: 'user_id,channel_id' })

  Postgres requires a matching UNIQUE/EXCLUDE constraint or index for that
  conflict target. Without it, upsert can fail and channels appear to
  "disappear" after refresh because they were never persisted.
*/

CREATE UNIQUE INDEX IF NOT EXISTS telegram_channels_user_channel_unique_idx
  ON telegram_channels (user_id, channel_id);

