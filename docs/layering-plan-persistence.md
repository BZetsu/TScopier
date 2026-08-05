# Layering Plan Persistence

Phase C added immutable persistence for Static and Dynamic layering modes. The
final integration phase wires those plans into guarded preparation and virtual
pending activation, but keeps the feature disabled by default. Legacy range
layering remains the default runtime path for existing users.

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
- `status`: starts as `prepared`; activation uses `activating` as the CAS/lock
  state before becoming `active`. Entry convergence may move an active plan to
  `entries_complete`; `completed` is reserved for the product-level terminal
  basket/trade rule.
- `layer_plan_metadata`: strict versioned `LayeringPlanSnapshot` JSON.
- `semantic_fingerprint`: canonical hash of immutable plan content. Lifecycle
  timestamps are excluded so retry-after-timeout can match the first persisted
  row without overwriting it.
- first-execution linkage: the immediate Static entry or Dynamic anchor fill is
  recorded with order/trade identifiers, confirmed status, fill price, filled
  lot, and confirmation timestamp during activation.
- `locked_at`: the immutable lock timestamp.

Access is worker/service-role only. The migration enables row-level security,
revokes table access from `anon` and `authenticated`, and grants table access to
`service_role`. Phase C defines no frontend/client policy and no public metadata
read path.

The Phase A nullable `range_pending_legs.layer_plan_id` and
`range_pending_legs.layer_plan_metadata` columns are used only on activated
funded legs. Legacy rows remain nullable.

## Rollout Controls

Static/Dynamic require all of the following before activation or execution:

- `LAYERING_MODES_EXECUTION_ENABLED=true`
- matching mode flag: `LAYERING_STATIC_EXECUTION_ENABLED=true` or
  `LAYERING_DYNAMIC_EXECUTION_ENABLED=true`
- `LAYERING_MODES_KILL_SWITCH=false`
- broker account ID present in `LAYERING_MODES_ACCOUNT_ALLOWLIST`
- `LAYERING_MODES_PREPARE_ONLY=false`

Defaults are fail-closed: global execution false, mode flags false, empty
allowlist, prepare-only true, and kill switch true. Legacy does not require
allowlisting.

When prepare-only is true, Static plans may be calculated and stored as
`prepared`, but no activation RPC runs, no executable `range_pending_legs` are
created, and no broker send is performed. Dynamic plans require an actual broker
fill before a final ladder can be calculated, so prepare-only blocks Dynamic
before the first order instead of inventing a quote/requested-price anchor.

Static/Dynamic `range_layering_type='pending_order'` is supported only for
adapter paths that already support native pending orders. The worker currently
supports FxSocket MT4/MT5 BuyLimit/SellLimit placement for immutable funded
plan levels. Unsupported adapters fail closed with `broker_pending_unsupported`;
the worker does not switch to virtual execution or Legacy behavior.

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

## Activation and Recovery

Activation is performed by the worker-only `activate_layering_plan` RPC. It locks
the exact prepared plan row, verifies the semantic fingerprint, verifies schema
and calculator versions, checks plan identity against stored metadata, reads
`fundedPrices` and `lots` from `layer_plan_metadata`, and inserts executable rows
from those persisted arrays only. Callers pass identity/control context, not
price or lot arrays. The RPC checks that no legs already exist for the plan ID,
materializes funded rows, and then marks the plan `active` in the same
transaction. The unique
`range_pending_legs(layer_plan_id, step_idx)` index prevents duplicate plan legs.

Static activation excludes layer 1 from pending-leg materialization because the
first layer is sent through the existing immediate-order path. Dynamic activation
excludes the actual first broker fill for the same reason. Dynamic pending levels
are calculated only after broker-confirmed fill price and actual fill lot are
known; the remaining intended lot is `planned total - actual first fill lot`, and
additional layers are never allocated if the first fill already exceeds the
intended total.

Recovery parses the persisted metadata and returns the exact funded prices and
lots. It does not consult current account settings, current quotes, Telegram
data, broker state, or rerun calculators. Optional materialized leg validation
checks exact plan ID, signal/account identity, step count, prices, lots, and
duplicate step indexes.

Recovery is status-aware:

- `prepared`: recoverable as an inert prepared plan.
- `activating`: recoverable for activation repair only; partial or mismatched
  legs must fail closed.
- `active`: parseable for monitor recovery and virtual pending execution.
- `entries_complete`: every intended entry leg, including the linked first
  execution, has reached terminal entry semantics; this is not a basket-close
  signal.
- `cancelling`, `cancellation_pending`, and `cancellation_manual_review`:
  non-executable cancellation states.
- `completed` and `cancelled`: terminal and not recoverable as an active plan.
- `invalid` or unknown statuses: fail closed.

Database row identity and lifecycle timestamps must match the strict metadata.
Metadata cannot override the database status.

## Execution Guards

`virtualPendingMonitor` and the broker-pending monitor validate any row carrying
`layer_plan_id` before it can be processed. The plan row must be `active`,
metadata must parse strictly, row identity must match the snapshot, step index,
trigger price, and lot must equal `fundedPrices[index]` and `lots[index]`, and
rollout controls must still allow execution. The kill switch and allowlist are
therefore checked before claim and again immediately before broker send in the
virtual pending path.

Broker-native Static/Dynamic activation places only funded rows after the
first/immediate layer. Each native pending layer uses a deterministic broker
comment reference:

```text
layer_<planDigest>_<stepIdx>
```

The digest is derived from `layer_plan_id`, `step_idx`, broker account identity,
and an execution-mechanism version. Before sending, the worker checks open broker
orders for that reference. Matching existing broker orders are adopted;
conflicting broker state fails closed and invalidates the plan. Ambiguous
outcomes, lookup outages, and reference lookup misses never make a leg sendable.
In V1, a lookup miss remains `reconciliation_required` or manual review until an
operator performs an explicit audited recovery outside the public client path.
The additive `range_pending_legs.broker_client_reference` unique index prevents
duplicate persisted references per broker account.

Native pending rows are persisted before any broker call. The lifecycle is:

- `planned`: RPC-materialized row, no broker call attempted.
- `submission_claimed`: one worker won the CAS claim, with deterministic
  reference, claim owner, claim timestamp, and attempt count persisted.
- `confirmed`: broker order is adopted or placed and the ticket/reference are
  stored.
- `reconciliation_required`: broker outcome is ambiguous, DB confirmation failed
  after broker acceptance, lookup failed, lookup missed, or reference conflict
  requires manual/recovery review.

Only `planned` is sendable by the ordinary placement loop. `submission_claimed`,
`submission_ambiguous`, `reconciliation_required`, `submitted`, `confirmed`,
`broker_pending`, `filled`, `cancelled`, conflict, and manual-review states are
not directly resendable. A stale `submission_claimed` row after restart is
treated as ambiguous and reconciled by deterministic reference; age alone is not
proof that the broker call never began.

Every native send rechecks rollout and plan integrity both before the durable
claim and immediately before `OrderSend`. If the kill switch, allowlist, mode
flag, prepare-only flag, or active-plan fingerprint changes between orders, the
worker stops before the next broker call and leaves confirmed orders recorded.
Worker startup and the broker-pending monitor run native submission recovery for
`submission_claimed`, `submission_ambiguous`, `reconciliation_required`, and
unconfirmed submitted native rows. Recovery validates the persisted plan and leg,
claims reconciliation ownership per leg, and looks up the broker by deterministic
reference. It adopts exact matches, invalidates conflicts, moves authoritative
lookup misses to `manual_review`, and leaves lookup outages non-sendable for a
later recovery pass. Recovery does not rerun calculators, use current settings,
reanchor from quotes, or fall back to virtual/Legacy behavior.
Recovery ownership is leased with `reconciliation_claimed_by` and
`reconciliation_claimed_at`. The lease defaults to 300 seconds and can be tuned
with `LAYERING_NATIVE_RECOVERY_LEASE_TIMEOUT_MS`. If a worker crashes during
recovery, a later startup or monitor tick can reclaim the row after the lease
expires; no manual SQL reset is required solely to clear a dead recovery owner.
Broker lookup outages release the recovery lease so later startup passes can
keep reconciling the same deterministic reference. A broker-authoritative lookup
miss is moved to `manual_review`; it remains non-sendable and requires explicit
operator review rather than automatic resend.

Plan lifecycle convergence is explicit. Active plans become `entries_complete`
only after the separately linked first execution is confirmed and every
materialized remaining leg is terminal with no native submission or cancellation
ambiguity. A native order still open at the broker prevents entry convergence.
The `completed` status is reserved for a product-level basket/trade terminal
transition; entry convergence alone must not claim the basket is closed.

Cancellation first moves the plan to `cancelling`, which blocks new virtual
claims and native submissions. Virtual unsent rows are locally cancelled. Native
broker-pending rows require an exact ticket/reference and an audited FxSocket
MT4/MT5 cancellation method. Cancellation first reconciles broker state:
pending orders receive one broker cancel request, filled orders are preserved as
filled, already-cancelled/rejected orders are adopted, and missing broker state
requires manual review. Broker cancel timeouts remain `cancellation_pending` and
restart recovery continues by reconciliation; it does not issue duplicate cancel
requests for rows that already have `cancellation_requested_at`. Missing
cancellation capability or missing ticket moves the plan to
`cancellation_manual_review` rather than falsely claiming cancelled. Immutable
metadata, tickets, and fill history are preserved. Invalid metadata, leg
mismatches, or conflicting broker references mark the plan `invalid`; invalid
plans cannot execute.

For Static/Dynamic first fills, the immediate broker fill lifecycle awaits plan
persistence and activation before returning success. The live-fast path may still
background non-layering follow-up work, but it does not background the
Static/Dynamic first-fill activation callback. If activation cannot be persisted,
the immediate-fill lifecycle reports the failure instead of silently losing the
immutable plan work after process exit.

The frontend uses the authenticated `layering-mode-capabilities` Edge Function
to decide whether Static/Dynamic and `pending_order` are selectable for a broker
account. The endpoint returns availability, stable reasons, limits, and
prepare-only state, but never exposes environment variables, allowlists, broker
credentials, or plan metadata. Capability lookup failure is treated as Legacy
only by the frontend.

Capability responses distinguish configuration from execution. In prepare-only
mode, an allowlisted account may be allowed to configure Static/Dynamic settings
for staged rollout, but `executionAvailable=false` and both `auto.executable`
and `pending_order.executable` are false.

Settings writes use the authenticated `update-layering-settings` Edge Function.
The function verifies the caller owns the broker account, checks plan entitlement,
validates mode/mechanism/count/step inputs, resolves server-side rollout and
FxSocket MT4/MT5 native-pending capability, and updates future manual settings
only. It does not create plans, activate plans, mutate `layering_plans`, or
change active locked plans. Database triggers reject authenticated direct updates
to layering settings, so the frontend capability check is not the authority.

No calculator is rerun after a plan is persisted. Settings changes affect future
signals only.

## Deployment Order

The final integration requires the database migration/RPC before activation is
enabled. Safe rollout sequence:

1. Apply the Phase A `range_pending_legs` nullable-column migration.
2. Apply the `layering_plans`/activation RPC migration.
3. Deploy worker/frontend code with all Static/Dynamic flags still disabled.
4. Smoke-test Legacy behavior.
5. Enable preparation for one allowlisted staging account with
   `LAYERING_MODES_PREPARE_ONLY=true`.
6. Verify prepared plans and no pending legs.
7. Disable prepare-only for one staging account and verify activation/restart
   behavior with a no-send or staging-only broker setup.
8. Expand allowlist gradually.

Emergency rollback: set `LAYERING_MODES_KILL_SWITCH=true`, disable mode flags,
or clear the allowlist. Do not delete immutable plan metadata or historical legs
during rollback.
