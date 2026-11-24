-- Allow informational audit outcomes in trade_execution_logs.
--
-- Plain English: the worker writes a record every time it does something to a
-- trade. Three of those records used a status label the table did not accept,
-- so the database threw them away without telling anyone. The cancelled-order
-- record (`signal_entry_pending_sync`) was one of them: when a pending order
-- vanished from the broker and the trade was cancelled, the explanation was
-- written and then silently discarded. That is why support could see a trade
-- was cancelled but never what cancelled it.
--
-- Affected actions (10 call sites, all previously rejected with SQLSTATE 23514):
--   info                   -> signal_entry_pending_sync, virtual_pending_expired,
--                             virtual_pending_tp_lock, virtual_pending_reanchor,
--                             virtual_pending_cancelled, range_layering_stopped,
--                             layering_execution_blocked, duplicate_leg_collapsed
--   warning                -> dispatch_sweep_fresh_alert
--   reconciliation_required -> layering_first_fill_activation
--
-- Verified against production before this change: every one of those actions
-- returned zero rows, i.e. no such record had ever been stored.
--
-- This follows the same pattern as
-- 20260615180000_trade_execution_logs_skipped_status.sql, which added
-- `skipped` for the same reason.

alter table public.trade_execution_logs
  drop constraint if exists trade_execution_logs_status_check;

alter table public.trade_execution_logs
  add constraint trade_execution_logs_status_check
  check (status in ('attempt', 'success', 'failed', 'skipped', 'info', 'warning', 'reconciliation_required'));
