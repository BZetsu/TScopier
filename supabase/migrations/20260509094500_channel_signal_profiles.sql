-- Channel signal behavior profiles (last N days)
CREATE TABLE IF NOT EXISTS channel_signal_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  lookback_days integer NOT NULL DEFAULT 30,
  sample_size integer NOT NULL DEFAULT 0,
  signal_type text NOT NULL DEFAULT 'unknown',
  tp_style text NOT NULL DEFAULT 'unknown',
  sl_style text NOT NULL DEFAULT 'unknown',
  entry_type text NOT NULL DEFAULT 'unknown',
  most_traded_asset text,
  estimated_tp_pips numeric(20,4),
  estimated_sl_pips numeric(20,4),
  analysis_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_signal_profiles_channel_unique UNIQUE (channel_id)
);

ALTER TABLE channel_signal_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own channel signal profiles"
  ON channel_signal_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own channel signal profiles"
  ON channel_signal_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own channel signal profiles"
  ON channel_signal_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own channel signal profiles"
  ON channel_signal_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS channel_signal_profiles_user_id_idx ON channel_signal_profiles(user_id);
CREATE INDEX IF NOT EXISTS channel_signal_profiles_channel_id_idx ON channel_signal_profiles(channel_id);
