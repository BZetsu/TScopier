/*
  Documentation only (no-op SELECT).

  1) Required for worker UPSERT on conflict:
     Apply migration `20260513140000_range_pending_unique_active_step.sql`
     so partial unique index `range_pending_legs_active_step_unique` exists on
     (signal_id, broker_account_id, symbol, step_idx) WHERE status IN ('pending','claimed').

  2) Optional manual orphan cleanup after deploying merge fall-through fix:
     Review rows first — do NOT run blindly if you rely on virtual-only ladders
     (no trades row yet) for a signal; those legitimately have no open trades.

     Example review:
       select r.id, r.signal_id, r.broker_account_id, r.symbol, r.step_idx, r.status
       from public.range_pending_legs r
       where r.status = 'pending'
         and not exists (
           select 1 from public.trades t
           where t.signal_id = r.signal_id
             and t.broker_account_id = r.broker_account_id
             and t.status in ('open', 'pending')
         );

     Then delete only confirmed orphan keys as needed.
*/

select 1 as _range_pending_merge_cleanup_notes;
