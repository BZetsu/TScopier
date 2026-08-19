/*
  # Trade reports — signal_id column

  Adds `signal_id` to `trade_reports` so reports filed from the assistant
  (including reports on skipped / non-actionable trades that have no symbol
  or ticket) are traceable back to the signal for support review.

  Backwards compatible: nullable column, existing rows unaffected, the
  manual Report modal path (ReportTradeModal) keeps working unchanged.
*/

ALTER TABLE trade_reports
  ADD COLUMN IF NOT EXISTS signal_id uuid;

CREATE INDEX IF NOT EXISTS trade_reports_signal_idx
  ON trade_reports (signal_id);