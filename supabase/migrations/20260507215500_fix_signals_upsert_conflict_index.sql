/*
  # Fix signals upsert ON CONFLICT index

  Worker uses:
    upsert(..., { onConflict: 'user_id,telegram_message_id', ignoreDuplicates: true })

  Postgres ON CONFLICT column inference requires a matching UNIQUE/EXCLUDE
  constraint/index on exactly those columns. A partial unique index is not
  inferable for this form, which causes:
    "there is no unique or exclusion constraint matching the ON CONFLICT specification"
*/

-- Keep newest row per (user_id, telegram_message_id) before adding unique index.
DELETE FROM signals s
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, telegram_message_id
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM signals
    WHERE telegram_message_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
) d
WHERE s.id = d.id;

-- Remove the partial index if it exists (not inferable by ON CONFLICT columns).
DROP INDEX IF EXISTS signals_user_msg_unique;

-- Create a full unique index that ON CONFLICT (user_id, telegram_message_id) can infer.
-- Postgres allows multiple NULLs in UNIQUE indexes, so rows with NULL telegram_message_id
-- remain valid and do not conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS signals_user_telegram_message_unique_idx
  ON signals (user_id, telegram_message_id);

