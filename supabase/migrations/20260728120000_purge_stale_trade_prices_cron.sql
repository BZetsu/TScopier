/*
  Purge stale trade price memory once baskets are done (no open/pending trades).

  Clears:
    - range_pending_legs (+ tp locks) for flat signal|broker baskets
    - channel_active_trade_params when channel+symbol has no open activity
    - basket_sl_tp_targets when the anchor basket is flat
    - finished signal_entry_pending_orders / signal_range_entry_waits
    - finished basket_reconcile_jobs (+ legs)

  Scheduled every 5 minutes via pg_cron so wrong-side / near-market SL-TP
  from a previous Gold cycle cannot re-apply to a fresh teaser entry.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.symbol_norm(p_symbol text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_symbol, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

COMMENT ON FUNCTION public.symbol_norm(text) IS
  'Normalize broker/signal symbols for compatibility (XAUUSD ~= XAUUSDm).';

CREATE OR REPLACE FUNCTION public.symbols_compatible(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    length(public.symbol_norm(p_a)) > 0
    AND length(public.symbol_norm(p_b)) > 0
    AND (
      public.symbol_norm(p_a) = public.symbol_norm(p_b)
      OR position(public.symbol_norm(p_a) in public.symbol_norm(p_b)) > 0
      OR position(public.symbol_norm(p_b) in public.symbol_norm(p_a)) > 0
    );
$$;

CREATE OR REPLACE FUNCTION public.purge_stale_trade_prices()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_range_legs int := 0;
  v_tp_locks int := 0;
  v_channel_params int := 0;
  v_basket_targets int := 0;
  v_entry_pending int := 0;
  v_range_waits int := 0;
  v_recon_legs int := 0;
  v_recon_jobs int := 0;
BEGIN
  -- 1) Range ladder rows for flat baskets (any status — ladder is finished)
  WITH flat_baskets AS (
    SELECT DISTINCT r.signal_id, r.broker_account_id
    FROM public.range_pending_legs r
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.trades t
      WHERE t.signal_id = r.signal_id
        AND t.broker_account_id = r.broker_account_id
        AND t.status IN ('open', 'pending')
    )
  ),
  del AS (
    DELETE FROM public.range_pending_legs r
    USING flat_baskets f
    WHERE r.signal_id = f.signal_id
      AND r.broker_account_id = f.broker_account_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_range_legs FROM del;

  -- 2) TP-touch locks for flat baskets
  WITH flat_locks AS (
    SELECT l.signal_id, l.broker_account_id
    FROM public.range_pending_tp_locks l
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.trades t
      WHERE t.signal_id = l.signal_id
        AND t.broker_account_id = l.broker_account_id
        AND t.status IN ('open', 'pending')
    )
  ),
  del AS (
    DELETE FROM public.range_pending_tp_locks l
    USING flat_locks f
    WHERE l.signal_id = f.signal_id
      AND l.broker_account_id = f.broker_account_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_tp_locks FROM del;

  -- 3) Channel SL/TP memory when channel+symbol has no open activity
  WITH active AS (
    SELECT DISTINCT
      s.user_id,
      s.channel_id,
      public.symbol_norm(t.symbol) AS sym_norm
    FROM public.trades t
    JOIN public.signals s ON s.id = t.signal_id
    WHERE t.status IN ('open', 'pending')
      AND t.symbol IS NOT NULL
      AND length(trim(t.symbol)) > 0

    UNION

    SELECT DISTINCT
      r.user_id,
      s.channel_id,
      public.symbol_norm(r.symbol)
    FROM public.range_pending_legs r
    JOIN public.signals s ON s.id = r.signal_id
    WHERE r.status IN ('pending', 'claimed', 'broker_pending')
      AND r.symbol IS NOT NULL

    UNION

    SELECT DISTINCT
      s.user_id,
      s.channel_id,
      public.symbol_norm(e.symbol)
    FROM public.signal_entry_pending_orders e
    JOIN public.signals s ON s.id = e.signal_id
    WHERE e.status = 'broker_pending'
      AND e.symbol IS NOT NULL
  ),
  stale_params AS (
    SELECT c.user_id, c.channel_id, c.symbol
    FROM public.channel_active_trade_params c
    WHERE NOT EXISTS (
      SELECT 1
      FROM active a
      WHERE a.user_id = c.user_id
        AND a.channel_id = c.channel_id
        AND public.symbols_compatible(c.symbol, a.sym_norm)
    )
  ),
  del AS (
    DELETE FROM public.channel_active_trade_params c
    USING stale_params s
    WHERE c.user_id = s.user_id
      AND c.channel_id = s.channel_id
      AND c.symbol = s.symbol
    RETURNING 1
  )
  SELECT count(*)::int INTO v_channel_params FROM del;

  -- 4) Basket desired SL/TP when anchor basket is flat
  WITH stale_targets AS (
    SELECT b.id
    FROM public.basket_sl_tp_targets b
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.trades t
      WHERE t.signal_id = b.anchor_signal_id
        AND t.broker_account_id = b.broker_account_id
        AND t.status IN ('open', 'pending')
    )
  ),
  del AS (
    DELETE FROM public.basket_sl_tp_targets b
    USING stale_targets s
    WHERE b.id = s.id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_basket_targets FROM del;

  -- 5) Finished entry pendings only (keep live broker_pending until filled/cancelled)
  WITH del AS (
    DELETE FROM public.signal_entry_pending_orders e
    WHERE e.status <> 'broker_pending'
       OR (e.expires_at IS NOT NULL AND e.expires_at < now())
    RETURNING 1
  )
  SELECT count(*)::int INTO v_entry_pending FROM del;

  -- 6) Finished / expired range-entry waits (keep active waiting rows)
  WITH del AS (
    DELETE FROM public.signal_range_entry_waits w
    WHERE w.status <> 'waiting'
       OR (w.expires_at IS NOT NULL AND w.expires_at < now())
    RETURNING 1
  )
  SELECT count(*)::int INTO v_range_waits FROM del;

  -- 7) Finished / flat basket reconcile jobs
  WITH stale_jobs AS (
    SELECT j.id
    FROM public.basket_reconcile_jobs j
    WHERE j.status IN ('done', 'completed', 'failed', 'cancelled')
       OR NOT EXISTS (
         SELECT 1
         FROM public.trades t
         WHERE t.signal_id = j.anchor_signal_id
           AND t.broker_account_id = j.broker_account_id
           AND t.status IN ('open', 'pending')
       )
  ),
  del_legs AS (
    DELETE FROM public.basket_reconcile_legs l
    USING stale_jobs s
    WHERE l.job_id = s.id
    RETURNING 1
  ),
  del_jobs AS (
    DELETE FROM public.basket_reconcile_jobs j
    USING stale_jobs s
    WHERE j.id = s.id
    RETURNING 1
  )
  SELECT
    (SELECT count(*)::int FROM del_legs),
    (SELECT count(*)::int FROM del_jobs)
  INTO v_recon_legs, v_recon_jobs;

  RETURN jsonb_build_object(
    'range_pending_legs', v_range_legs,
    'range_pending_tp_locks', v_tp_locks,
    'channel_active_trade_params', v_channel_params,
    'basket_sl_tp_targets', v_basket_targets,
    'signal_entry_pending_orders', v_entry_pending,
    'signal_range_entry_waits', v_range_waits,
    'basket_reconcile_legs', v_recon_legs,
    'basket_reconcile_jobs', v_recon_jobs,
    'purged_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.purge_stale_trade_prices() IS
  'Delete range ladders, channel SL/TP memory, and basket targets for flat baskets. Safe to run periodically.';

GRANT EXECUTE ON FUNCTION public.purge_stale_trade_prices() TO service_role;

-- Schedule: every 5 minutes
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'purge-stale-trade-prices';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'purge-stale-trade-prices',
  '*/5 * * * *',
  $cmd$
  SELECT public.purge_stale_trade_prices();
  $cmd$
);
