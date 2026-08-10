/*
  # Trade Reports

  ## Overview
  Creates the `trade_reports` table for user-submitted reports about trades that
  executed incorrectly or look wrong. A user can report any trade from the trade
  detail modal; support staff review reports in the admin dashboard.

  ## Columns
  - id: UUID primary key
  - user_id: References auth.users (who filed the report)
  - symbol, direction: Trade snapshot (denormalized from live broker data)
  - ticket: Broker ticket number shown to the user
  - broker_label: Human label of the broker account the trade was on
  - entry_price, sl, tp, lot_size: Price/volume snapshot at report time
  - category: Optional issue category (wrong entry, wrong SL/TP, wrong direction, etc.)
  - reason: Free-text description of the problem
  - status: open | resolved
  - created_at, updated_at: Timestamps

  ## Security
  - Users can insert and view only their own reports.
  - Admin read/update access is granted separately (admin dashboard migration).
*/

CREATE TABLE IF NOT EXISTS trade_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT '',
  ticket text,
  broker_label text,
  entry_price numeric(20,8),
  sl numeric(20,8),
  tp numeric(20,8),
  lot_size numeric(10,2),
  category text,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own trade reports"
  ON trade_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own trade reports"
  ON trade_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS trade_reports_user_created_idx
  ON trade_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trade_reports_status_idx
  ON trade_reports (status);
