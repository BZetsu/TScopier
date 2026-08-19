/*
  # Assistant Chat Threads

  ## Overview
  Persists AI assistant chat threads to the database so conversations survive
  browser restarts. Previously threads lived only in the browser's
  sessionStorage and were wiped whenever the tab closed.

  The frontend writes/reads these rows through the Supabase client using RLS
  (same pattern as user_profiles / broker_accounts). sessionStorage remains a
  local cache and offline fallback; the DB is the source of truth.

  ## Columns
  - id: UUID primary key
  - user_id: References auth.users (thread owner)
  - title: Short auto-derived title from the first user message
  - messages: JSONB array of { role, content, images?, tool_results? }
  - created_at, updated_at: Timestamps

  ## Security
  - RLS: users can select/insert/update/delete only their own threads.
  - A trigger caps each user at 8 threads (newest first), mirroring the
    client-side MAX_THREADS limit.
  - A timestamp trigger sets created_at/updated_at server-side so ordering,
    recency merges, and the cap all use the server clock (never client-supplied).

  ## Note
  Apply once. The table/index/function/trigger statements are idempotent, but
  CREATE POLICY has no IF NOT EXISTS, so re-applying this file will error on the
  policies. Use the repo's apply-missing-migrations flow which records applied
  versions.
*/

CREATE TABLE IF NOT EXISTS assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assistant_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assistant threads"
  ON assistant_threads FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assistant threads"
  ON assistant_threads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own assistant threads"
  ON assistant_threads FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own assistant threads"
  ON assistant_threads FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS assistant_threads_user_updated_idx
  ON assistant_threads (user_id, updated_at DESC);

-- Defense-in-depth: keep at most MAX_THREADS (8) per user even if a buggy
-- client or a compromised session bypasses the client-side cap.
CREATE OR REPLACE FUNCTION cap_assistant_threads()
RETURNS trigger AS $$
DECLARE
  excess_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO excess_ids
  FROM (
    SELECT id
    FROM assistant_threads
    WHERE user_id = NEW.user_id
    ORDER BY updated_at DESC
    OFFSET 8
  ) AS over_limit;

  IF excess_ids IS NOT NULL THEN
    DELETE FROM assistant_threads WHERE id = ANY(excess_ids);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assistant_threads_cap ON assistant_threads;
CREATE TRIGGER assistant_threads_cap
  AFTER INSERT OR UPDATE ON assistant_threads
  FOR EACH ROW
  EXECUTE FUNCTION cap_assistant_threads();

-- Trust the server clock for ordering/recency instead of client-supplied values.
CREATE OR REPLACE FUNCTION set_assistant_thread_timestamps()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assistant_threads_timestamps ON assistant_threads;
CREATE TRIGGER assistant_threads_timestamps
  BEFORE INSERT OR UPDATE ON assistant_threads
  FOR EACH ROW
  EXECUTE FUNCTION set_assistant_thread_timestamps();
