# Layering Plan Persistence

Phase C adds immutable persistence for future Static and Dynamic layering modes.
It does not enable execution. Legacy range layering remains the only production
runtime path.

## Storage Design

Static/Dynamic plans are stored in `public.layering_plans`, not as active
`range_pending_legs` rows. This makes accidental broker execution impossible in
Phase C because the current monitors only process active `range_pending_legs`
statuses such as `pending`, `claimed`, and `broker_pending`.

Each plan is stored with:

- `layer_plan_id`: deterministic safe ID generated from signal, broker account,
  basket key, symbol, side, and mode. Inputs are canonicalized with stable keys
  before hashing so separator-like values cannot collide.
- `mode`: `static` or `dynamic`.
- `status`: starts as `prepared`.
- `layer_plan_metadata`: strict versioned `LayeringPlanSnapshot` JSON.
- `locked_at`: the immutable lock timestamp.

Access is worker/service-role only. The migration enables row-level security,
revokes table access from `anon` and `authenticated`, and grants table access to
`service_role`. Phase C defines no frontend/client policy and no public metadata
read path.

The Phase A nullable `range_pending_legs.layer_plan_id` and
`range_pending_legs.layer_plan_metadata` columns remain for Phase D traceability
when funded legs are eventually materialized.

## Snapshot Contract

`LayeringPlanSnapshot` uses:

- `schemaVersion: 1`
- `calculatorVersion: "layering-v1"`

Unknown versions fail closed. Null old metadata still means Legacy, but malformed
non-null Static/Dynamic metadata is rejected rather than downgraded.

Snapshots persist only the canonical executable plan fields needed for restart
recovery:

- `fundedPrices`
- `lots`
- `plannedLayerCount`
- `plannedTotalLot`
- `allocatedTotalLot`
- `unallocatedLot`
- static/dynamic configuration snapshots
- raw and executable anchor fields where applicable
- stable calculation reasons

Candidate and unfunded prices are diagnostics from Phase B calculators and are
not required for execution recovery.

For Static/Dynamic metadata to parse, persisted financial totals must be
self-consistent: `fundedPrices.length === lots.length`,
`plannedLayerCount === fundedPrices.length`, `allocatedTotalLot` must equal the
decimal-safe sum of `lots`, `unallocatedLot` must equal
`plannedTotalLot - allocatedTotalLot`, and allocation must never exceed
`plannedTotalLot`. Values with more than 12 decimal places fail closed rather
than being rounded into a different plan.

## Idempotency

Persisting the same plan ID with matching metadata returns
`already_exists_matching`. Persisting the same ID with different immutable
metadata returns `conflict`; locked metadata is never overwritten.

Matching is semantic. The worker computes a canonical fingerprint from immutable
plan content and excludes lifecycle timestamps such as `createdAt`, `lockedAt`,
database `created_at`, and `updated_at`. A retry after a timeout reloads the
exact `layer_plan_id`; if semantic content matches, the existing row and its
original timestamps remain authoritative.

## Recovery

Recovery parses the persisted metadata and returns the exact funded prices and
lots. It does not consult current account settings, current quotes, Telegram
data, broker state, or rerun calculators. Optional materialized leg validation
checks exact plan ID, signal/account identity, step count, prices, lots, and
duplicate step indexes.

Recovery is status-aware:

- `prepared`: recoverable as an inert prepared plan.
- `active`: parseable read-only for future Phase D recovery; Phase C still does
  not activate or execute it.
- `completed` and `cancelled`: terminal and not recoverable as an active plan.
- `invalid` or unknown statuses: fail closed.

Database row identity and lifecycle timestamps must match the strict metadata.
Metadata cannot override the database status.

## Deployment Order

Phase C migration and code are additive. Either can be deployed first because no
runtime path writes Static/Dynamic executable legs and the unsupported-mode guard
still blocks planner execution.

Before Phase D execution enablement:

1. Apply the Phase A `range_pending_legs` nullable-column migration.
2. Apply the Phase C `layering_plans` migration.
3. Deploy Phase D execution integration.
4. Keep `LAYERING_MODES_EXECUTION_ENABLED=false` until the complete guarded
   activation/materialization path is verified.

Rollback of Phase C code does not require dropping `layering_plans`; prepared
plans are inert until a future execution phase activates them.
