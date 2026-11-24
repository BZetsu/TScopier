-- PART 1 of 2 - THE FIX.  Open this file, Select All, copy, paste, run.
-- Target: production sxkpcovbyaficvtkpsdo (UniCopier)
-- Re-runnable. Widening only - no existing row is affected, nothing is
-- deleted, and it is reversible by re-running with the original four values.
--
-- Why: the worker writes a status label the table did not accept
-- (info / warning / reconciliation_required), so the database rejected those
-- audit records silently. Cancelled-order records were among them.

-- 1a. BEFORE - expect 4 values: attempt / success / failed / skipped
SELECT conname, pg_get_constraintdef(oid) AS current_definition
FROM pg_constraint
WHERE conname = 'trade_execution_logs_status_check';

-- 1b. Widen it to 7 values
ALTER TABLE public.trade_execution_logs
  DROP CONSTRAINT IF EXISTS trade_execution_logs_status_check;

ALTER TABLE public.trade_execution_logs
  ADD CONSTRAINT trade_execution_logs_status_check
  CHECK (status IN ('attempt', 'success', 'failed', 'skipped',
                    'info', 'warning', 'reconciliation_required'));

-- 1c. AFTER - expect 7 values including info, warning, reconciliation_required
SELECT pg_get_constraintdef(oid) AS new_definition
FROM pg_constraint
WHERE conname = 'trade_execution_logs_status_check';
