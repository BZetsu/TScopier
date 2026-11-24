-- PART 2 of 2 - THE RECEIPT. Run only after Part 1 reports 7 values.
-- Target: production sxkpcovbyaficvtkpsdo (UniCopier)
-- Re-runnable (ON CONFLICT DO NOTHING).
--
-- Why: migrations applied by hand in the dashboard never write their own
-- receipt, so `supabase migration list` keeps reporting this file as
-- "local only" even though it is applied. (PROJECT_MEMORY 2026-08-17:
-- "Registration != applied".)

-- 2a. Register the receipt
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES (
  '20261123150000',
  ARRAY['-- allow informational audit statuses in trade_execution_logs'],
  '20261123150000_trade_execution_logs_info_status'
)
ON CONFLICT (version) DO NOTHING;

-- 2b. Confirm it registered
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version = '20261123150000';
