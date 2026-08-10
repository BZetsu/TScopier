-- Defense-in-depth for broker order persistence.
--
-- The worker claim prevents duplicate dispatches. This database constraint
-- prevents the same broker order ticket from being persisted twice for the
-- same broker account if a worker retries or loses its response.
--
-- The guard applies to trades created from the install cutoff (2026-08-05)
-- onward only. Historical duplicate tickets (pre-cutoff) are excluded so the
-- index can be created "on top" of existing data without deleting or merging
-- anything; those historical duplicates still require a separate manual audit.
-- If any duplicate ticket group exists AT OR AFTER the cutoff, this migration
-- stops and reports the required audit instead of silently proceeding.

DO $$
DECLARE
  duplicate_count bigint;
  cutoff timestamptz := '2026-08-05T00:00:00Z';
BEGIN
  SELECT count(*)
    INTO duplicate_count
  FROM (
    SELECT broker_account_id, metaapi_order_id
    FROM public.trades
    WHERE broker_account_id IS NOT NULL
      AND metaapi_order_id IS NOT NULL
      AND created_at >= cutoff
    GROUP BY broker_account_id, metaapi_order_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create trades broker-ticket uniqueness guard: % duplicate broker ticket groups created after the cutoff require manual audit first',
      duplicate_count
      USING HINT = 'Group trades by broker_account_id and metaapi_order_id, reconcile the broker records, then rerun this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS trades_broker_order_unique_idx
  ON public.trades (broker_account_id, metaapi_order_id)
  WHERE broker_account_id IS NOT NULL
    AND metaapi_order_id IS NOT NULL
    AND created_at >= '2026-08-05T00:00:00Z';

CREATE INDEX IF NOT EXISTS trades_signal_broker_opened_idx
  ON public.trades (signal_id, broker_account_id, opened_at)
  WHERE signal_id IS NOT NULL
    AND broker_account_id IS NOT NULL;

COMMENT ON INDEX public.trades_broker_order_unique_idx IS
  'Prevents the same broker order ticket from being persisted twice for one broker account (applies to trades created from 2026-08-05 onward; earlier rows are excluded from the uniqueness check).';

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20260805000000', '{ "-- migration applied via API" }', '20260805000000_trades_idempotency_guard.sql')
ON CONFLICT (version) DO NOTHING;
