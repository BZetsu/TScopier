-- Fix trade_execution_logs retention priority ordering.
--
-- The deployed function ranked priority action types LAST (CASE ... THEN 1 ELSE 0 END ASC),
-- so once a user exceeded p_keep rows, the priority rows (pipeline_summary, handle_start,
-- handle_end, dispatch_received, ...) were deleted FIRST — exactly the opposite of the
-- intent. A continuous auto_be failure flood (disconnected broker, one failed row per tick)
-- consumed the whole budget and silently wiped out all real pipeline logs for that user.
--
-- This migration makes the priority ranking authoritative in migrations and flips the
-- ordering to DESC so priority action types always survive pruning.

CREATE OR REPLACE FUNCTION public.prune_all_trade_execution_logs(
  p_keep integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_keep < 1 THEN
    p_keep := 500;
  END IF;
  -- Never keep fewer than 500 displayable-priority slots (guards misconfigured callers).
  IF p_keep < 500 THEN
    p_keep := 500;
  END IF;

  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id
        ORDER BY
          CASE
            WHEN action IN (
              'pipeline_summary',
              'dispatch_push_attempt',
              'parse_shadow_diff',
              'v2_reconcile_tick',
              'basket_reconcile_tick',
              'handle_start',
              'handle_end',
              'dispatch_received',
              'dispatch_route_decision',
              'dispatch_enqueue_attempt',
              'dispatch_enqueue_failed',
              'queue_consume_start',
              'queue_consume_ack',
              'queue_consume_retry',
              'queue_dead_letter',
              'merge_anchor_selected',
              'merge_routed_modify_only',
              'virtual_pending_tp_lock',
              'signal_entry_pending_sync',
              'news_pre_close',
              'multi_range_plan',
              'stale_basket_reconciled'
            ) THEN 1
            ELSE 0
          END DESC,
          created_at DESC,
          id DESC
      ) AS rn
    FROM public.trade_execution_logs
  ),
  doomed AS (
    SELECT id FROM ranked WHERE rn > p_keep
  )
  DELETE FROM public.trade_execution_logs t
  USING doomed d
  WHERE t.id = d.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.prune_all_trade_execution_logs IS
  'Batch retention: keep newest p_keep trade_execution_logs rows per user (default 500). Priority action types rank first (DESC) so they survive pruning; non-priority rows (e.g. auto_be failure floods) are pruned first. Run on a schedule (worker or pg_cron).';

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES (
  '20260811100000',
  ARRAY['-- Fix trade_execution_logs retention priority ordering.'],
  'fix_retention_priority_ordering'
)
ON CONFLICT (version) DO NOTHING;

SELECT prosrc
FROM pg_proc
WHERE proname = 'prune_all_trade_execution_logs';
