-- =============================================================================
-- APPLY BY HAND: allow informational audit statuses in trade_execution_logs
-- Target: production  sxkpcovbyaficvtkpsdo  (UniCopier)
-- Date:   2026-11-23
-- Why:    the Management API token available to the agent runs in a read-only
--         transaction (ERROR 25006), and the Supabase CLI token lacks the
--         `database_write` permission, so this cannot be applied automatically.
--
-- >>> RUN THIS FILE IN TWO SEPARATE PASTES. <<<
-- The dashboard SQL editor sends the whole paste as ONE transaction, so any
-- error rolls back everything above it. Running Part 1 on its own means the
-- actual fix is committed even if Part 2 has a problem.
--
-- Plain English: the worker writes a record every time it touches a trade.
-- Three of those records used a status label the table did not accept, so the
-- database threw them away without telling anyone. The cancelled-order record
-- (`signal_entry_pending_sync`) was one of them: when a resting order vanished
-- from the broker and the trade was cancelled, the explanation was written and
-- then silently discarded. That is why support could see a trade was cancelled
-- but never what cancelled it.
--
-- Affected actions (10 call sites, all previously rejected with SQLSTATE 23514):
--   info                    -> signal_entry_pending_sync, virtual_pending_expired,
--                              virtual_pending_tp_lock, virtual_pending_reanchor,
--                              virtual_pending_cancelled, range_layering_stopped,
--                              layering_execution_blocked, duplicate_leg_collapsed
--   warning                 -> dispatch_sweep_fresh_alert
--   reconciliation_required -> layering_first_fill_activation
--
-- Verified against production before this change: every one of those actions
-- returned zero rows, i.e. no such record had ever been stored.
--
-- This follows the same pattern as
-- 20260615180000_trade_execution_logs_skipped_status.sql, which added
-- `skipped` for the same reason.
-- =============================================================================


-- ############################################################################
-- # PART 1 — THE FIX. Run this block on its own first.                       #
-- ############################################################################

-- 1a. What the constraint is RIGHT NOW.
--     Expect 4 values: attempt / success / failed / skipped
SELECT conname, pg_get_constraintdef(oid) AS current_definition
FROM pg_constraint
WHERE conname = 'trade_execution_logs_status_check';

-- 1b. Widen it. Widening only: no existing row is affected, nothing is
--     deleted, and the change is reversible by re-running with the original
--     four values.
ALTER TABLE public.trade_execution_logs
  DROP CONSTRAINT IF EXISTS trade_execution_logs_status_check;

ALTER TABLE public.trade_execution_logs
  ADD CONSTRAINT trade_execution_logs_status_check
  CHECK (status IN ('attempt', 'success', 'failed', 'skipped',
                    'info', 'warning', 'reconciliation_required'));

-- 1c. VERIFY — expect 7 values including info, warning, reconciliation_required.
SELECT pg_get_constraintdef(oid) AS new_definition
FROM pg_constraint
WHERE conname = 'trade_execution_logs_status_check';


-- ############################################################################
-- # PART 2 — THE RECEIPT. Run this as a SECOND paste, after Part 1 succeeds. #
-- ############################################################################

-- 2a. Register the receipt, so `supabase migration list` stops reporting this
--     file as local-only. (Dashboard-applied migrations do not self-register —
--     see PROJECT_MEMORY 2026-08-17: "Registration != applied".)
--
--     NOTE: `statements` is a text[] column, NOT json. The value must be an
--     ARRAY[...] literal. Writing '[{"sql": ...}]' is parsed as an array
--     literal and fails with SQLSTATE 22P02 — which is what happened on the
--     first attempt. Existing rows store a plain comment string, e.g.
--     ["-- 20261118170000_extension_window_after_subscription"].
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES (
  '20261123150000',
  ARRAY['-- allow informational audit statuses in trade_execution_logs'],
  '20261123150000_trade_execution_logs_info_status'
)
ON CONFLICT (version) DO NOTHING;

-- 2b. Confirm the migration is registered.
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version = '20261123150000';


-- ############################################################################
-- # PART 3 — OPTIONAL. Run later, after the worker is redeployed.            #
-- ############################################################################

-- 3a. Today every one of these returns 0 rows. After the worker ships, they
--     should start returning counts — that is the proof the fix is working.
SELECT action, count(*) AS rows_stored
FROM trade_execution_logs
WHERE action IN ('signal_entry_pending_sync', 'virtual_pending_expired',
                 'virtual_pending_cancelled', 'duplicate_leg_collapsed',
                 'layering_execution_blocked', 'dispatch_sweep_fresh_alert',
                 'layering_first_fill_activation')
GROUP BY action
ORDER BY action;
