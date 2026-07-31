# Static/Dynamic Layering Staging Runbook

Static/Dynamic layering remains disabled by default. Use staging-only broker
accounts and never use production Telegram, Redis, Supabase, Railway, Sentry, or
broker credentials for these checks.

## Stage 1 - Prepare Only

Flags:

```env
LAYERING_MODES_EXECUTION_ENABLED=true
LAYERING_STATIC_EXECUTION_ENABLED=true
LAYERING_DYNAMIC_EXECUTION_ENABLED=true
LAYERING_MODES_ACCOUNT_ALLOWLIST=<staging-broker-account-id>
LAYERING_MODES_PREPARE_ONLY=true
LAYERING_MODES_KILL_SWITCH=false
```

Expected results:

- Static range signal creates or reuses one `layering_plans` row with
  `status='prepared'`.
- Dynamic does not create a final ladder until an actual first fill exists.
- No Static/Dynamic `range_pending_legs` rows are inserted.
- No broker-native pending orders are placed.
- The account settings capability response may mark Static/Dynamic configurable
  for an allowlisted Advanced staging account, but `executionAvailable=false`
  and both execution mechanisms return `executable=false`.
- No candidate or unfunded prices are persisted as executable legs.

Useful read-only checks:

```sql
select layer_plan_id, mode, status, semantic_fingerprint, created_at, locked_at
from public.layering_plans
where broker_account_id = '<staging-broker-account-id>'
order by created_at desc
limit 20;

select id, layer_plan_id, status, step_idx, trigger_price, volume
from public.range_pending_legs
where broker_account_id = '<staging-broker-account-id>'
  and layer_plan_id is not null
order by created_at desc;
```

## Stage 2 - Controlled Activation With No-Send Broker

Flags:

```env
LAYERING_MODES_EXECUTION_ENABLED=true
LAYERING_STATIC_EXECUTION_ENABLED=true
LAYERING_DYNAMIC_EXECUTION_ENABLED=true
LAYERING_MODES_ACCOUNT_ALLOWLIST=<staging-broker-account-id>
LAYERING_MODES_PREPARE_ONLY=false
LAYERING_MODES_KILL_SWITCH=false
```

Expected results:

- Activation transitions `prepared -> activating -> active`.
- The RPC inserts only funded pending rows derived from persisted
  `layer_plan_metadata`; callers cannot provide price or lot arrays.
- `range_pending_legs(layer_plan_id, step_idx)` is unique.
- Static layer 1 is not duplicated as a pending row.
- Dynamic actual first fill is not resent as a pending row.
- Restart recovery parses persisted metadata and does not rerun calculators.
- Two workers racing for the same trigger produce one durable claim.
- Active plans become `entries_complete` only after the separately linked first
  execution is confirmed and every remaining plan leg is terminal. Open native
  broker orders and reconciliation-required rows keep the plan active or blocked
  for recovery.

## Stage 3 - Controlled Staging Broker Account

Run only after Stage 2 passes.

- Use one staging account with minimum lot.
- Select `range_layering_type='auto'`.
- Send one Static range signal and one Dynamic range signal.
- Restart the worker while a plan is active.
- Toggle `LAYERING_MODES_KILL_SWITCH=true` and confirm no new claims or sends.
- Cancel the basket and confirm remaining pending legs stop firing.
- Confirm the plan does not reach `entries_complete` if the first execution
  linkage is missing or unconfirmed.
- Verify no duplicate broker orders, no duplicated `step_idx`, and no total
  exposure above the persisted allocation.

## Stage 4 - Broker-Native Pending Orders

Run only after Stage 3 passes, and only on an FxSocket MT4/MT5 staging account
that supports native pending orders.

- Select `range_layering_type='pending_order'`.
- Send one Static range signal and verify the immediate first layer is not
  duplicated as a broker pending order.
- Send one Dynamic range signal and verify the actual first broker fill anchors
  the plan; only remaining funded levels become broker pending orders.
- Verify each remaining row has `broker_client_reference`,
  `broker_pending_type`, `native_submission_status`, `submission_claimed_at`,
  `submission_attempt`, `ticket`, `submitted_at`, `confirmed_at`, and
  `last_reconciled_at`.
- For every broker order, confirm the database row reached
  `submission_claimed` before the broker call and `confirmed` only after the
  ticket/reference were stored.
- Restart the worker and verify startup recovery discovers
  `submission_claimed`, `submission_ambiguous`, `reconciliation_required`, and
  unconfirmed submitted native rows without placing duplicate pending orders.
- Simulate a broker timeout or worker crash window with mocks/staging harness
  and verify the row moves to `reconciliation_required`. A reference match must
  be adopted, a conflict must fail closed, and an authoritative lookup miss must
  move to `manual_review`; it must not trigger another `OrderSend`.
- Verify `reconciliation_claimed_by` leases expire according to
  `LAYERING_NATIVE_RECOVERY_LEASE_TIMEOUT_MS` and that a restarted worker can
  reclaim and continue reconciling without manual SQL cleanup. Lookup outages
  must release the recovery lease for later retry while remaining non-sendable.
- Flip kill switch, mode flag, prepare-only, and allowlist between native orders;
  the first confirmed order remains recorded and no later order is sent.
- Cancel a native-pending plan and verify FxSocket cancel is called for open
  broker orders only after broker-state reconciliation. Already-filled orders
  must remain filled, already-cancelled orders must be adopted, duplicate cancel
  calls must not issue another broker cancel, and timeouts must leave
  `cancellation_pending` for restart reconciliation. Missing cancellation
  capability or missing tickets must leave `cancellation_manual_review`.
- For Static/Dynamic first fills, verify live-fast execution does not return
  success until immutable plan persistence and activation have completed.
- Test broker rejection, market-closed behavior, and stop/min-distance
  rejection. Unsupported adapters must return `broker_pending_unsupported`
  rather than switching to virtual execution.

Useful native pending checks:

```sql
select layer_plan_id, step_idx, status, broker_client_reference,
       broker_pending_type, native_submission_status, submission_claimed_at,
       submission_attempt, ticket, trigger_price, volume,
       broker_pending_reason, reconciliation_reason
from public.range_pending_legs
where broker_account_id = '<staging-broker-account-id>'
  and layer_plan_id is not null
order by created_at desc;
```

## Authoritative Settings Save

The frontend must save layering fields through the `update-layering-settings`
Edge Function. Direct authenticated updates to `manual_settings` are blocked by
the migration when any protected layering field changes. The function may save
allowlisted Static/Dynamic configuration while prepare-only is true, but the
capability response must still show execution as unavailable.

Rollback at any stage:

```env
LAYERING_MODES_KILL_SWITCH=true
LAYERING_STATIC_EXECUTION_ENABLED=false
LAYERING_DYNAMIC_EXECUTION_ENABLED=false
LAYERING_MODES_ACCOUNT_ALLOWLIST=
```

Do not drop `layering_plans` or delete historical pending legs during rollback.
