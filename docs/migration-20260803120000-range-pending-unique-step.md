# Migration: 20260803120000 — Range Pending Broker-Pending Unique Step

**File:** `supabase/migrations/20260803120000_range_pending_broker_pending_unique_step.sql`
**Status on prod (`sxkpcovbyaficvtkpsdo`):** ✅ Applied — DO NOT re-run
**Status on staging (`axdcledcyhyvzrnfkwat`):** ✅ Applied

## What it does

Broker Pending mode stores live BuyLimit/SellLimit rungs as
`range_pending_legs.status = 'broker_pending'`. The previous unique index only
covered virtual statuses (`pending`/`claimed`), so two concurrent materialize
passes could INSERT the same step twice after both OrderSends — duplicate
limits at the same price on the chart.

This migration:
1. **Cancels** older duplicate `broker_pending` rows, keeping the newest ticket
   per step (a material data change — that is why it must not be re-run blindly).
2. Drops and recreates the partial unique index so it now also covers
   `broker_pending`.

## Verified state on prod (2026-08-05)

```sql
SELECT indexdef
FROM pg_indexes
WHERE indexname = 'range_pending_legs_active_step_unique';
```

Expected result (already true on prod):

```
CREATE UNIQUE INDEX range_pending_legs_active_step_unique ON public.range_pending_legs USING btree (signal_id, broker_account_id, symbol, step_idx) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'broker_pending'::text]))
```

Prod's index already includes `broker_pending`, meaning the migration was
applied manually. It is **not registered** in `supabase_migrations.schema_migrations`.

## Recommended action: register only, do not re-run

Re-running the file would re-execute the duplicate-cancellation UPDATE (a
material data change) for no benefit. Only the registration row is missing:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20260803120000', '{ "-- migration applied via API" }', '20260803120000_range_pending_broker_pending_unique_step.sql')
ON CONFLICT (version) DO NOTHING;
```

## Migration SQL (reference only — already applied)

```sql
/*
  Broker Pending mode stores live BuyLimit/SellLimit rungs as
  range_pending_legs.status = 'broker_pending'. The previous unique index only
  covered virtual statuses (pending/claimed), so two concurrent materialize
  passes could INSERT the same step twice after both OrderSends — duplicate
  limits at the same price on the chart.

  Expand the partial unique index to include broker_pending.
*/

-- Cancel older duplicate broker_pending rows (keep newest ticket per step).
with ranked as (
  select
    id,
    row_number() over (
      partition by signal_id, broker_account_id, symbol, step_idx
      order by
        case when ticket is not null and ticket <> '' then 0 else 1 end,
        created_at desc nulls last,
        id desc
    ) as rn
  from public.range_pending_legs
  where status = 'broker_pending'
)
update public.range_pending_legs r
set
  status = 'cancelled',
  error_message = coalesce(nullif(r.error_message, ''), 'duplicate_broker_pending_step_cleanup')
from ranked
where r.id = ranked.id
  and ranked.rn > 1;

drop index if exists public.range_pending_legs_active_step_unique;

create unique index if not exists range_pending_legs_active_step_unique
  on public.range_pending_legs (signal_id, broker_account_id, symbol, step_idx)
  where status in ('pending', 'claimed', 'broker_pending');

comment on index public.range_pending_legs_active_step_unique is
  'At most one active virtual (pending/claimed) or broker_pending leg per (signal, broker, symbol, step_idx).';
```
