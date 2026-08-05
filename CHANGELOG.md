# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning where practical.

## [Unreleased]

### Added

- Added Phase A foundation for range-layering modes: `legacy`, `static`, and `dynamic` manual-settings fields, backward-compatible legacy defaults, immutable layer-plan metadata persistence, and a disabled-by-default execution feature gate.
- Added Phase B pure Static/Dynamic layer-plan calculators, price normalization/deduplication helpers, deterministic lot allocation, and calculator documentation without integrating them into execution.
- Added Phase C immutable Static/Dynamic layering-plan persistence with deterministic plan IDs, versioned snapshots, idempotent prepared-plan storage, restart recovery helpers, and non-executable funded-leg materialization tests without enabling broker execution.
- Added final guarded Static/Dynamic layering integration with account allowlist rollout controls, prepare-only mode, kill switch enforcement, immutable plan preparation, CAS/RPC activation, active virtual pending materialization from `fundedPrices`/`lots`, and strict active-plan validation before pending-leg firing. Static/Dynamic remain disabled by default.
- Added guarded Static/Dynamic broker-native pending-order activation for supported FxSocket MT4/MT5 accounts, using immutable `fundedPrices`/`lots`, deterministic per-leg broker references, pre-send reconciliation, and additive pending-leg broker reference metadata. Legacy broker-pending behavior remains unchanged.
- Added an authenticated server-authoritative layering capability response and account settings controls for selecting Legacy, Static, or Dynamic modes separately from the `auto`/`pending_order` execution mechanism. Static/Dynamic controls fail closed unless the backend capability response enables them for the account.
- Added worker rollout controls for `LAYERING_STATIC_EXECUTION_ENABLED`, `LAYERING_DYNAMIC_EXECUTION_ENABLED`, `LAYERING_MODES_ACCOUNT_ALLOWLIST`, `LAYERING_MODES_PREPARE_ONLY`, and fail-closed `LAYERING_MODES_KILL_SWITCH`.
- Added durable broker-native layering submission state (`planned -> submission_claimed -> confirmed` plus reconciliation states), per-order rollout rechecks, FxSocket MT4/MT5 native capability gating, and plan completion/cancellation convergence for Static/Dynamic plans.
- Added final native layering safety hardening: ambiguous native states never auto-resend after reference lookup misses, startup recovery reconciles native submission states, native cancellation calls/reconciles broker cancellation, and plan entry convergence requires persisted first-execution linkage.
- Added fail-closed load-harness safety guards, deterministic synthetic signal generation, worker safety preflight, emergency stop support, cleanup helpers, and JSON run reporting.
- Added disabled-by-default, worker-only Sentry monitoring with all SDK default integrations disabled, defensive redaction, role/shard tags, bounded shutdown flushing, and targeted sanitized-helper capture for final Telegram, queue, broker, persistence, range-layer, reconciliation, and lifecycle failures.
- Added centralized worker Sentry business-event observability for user-impacting trade copy, broker account, Telegram/copier, management, layering, queue, persistence, and reconciliation failures with stable event names, hashed identifiers, grouping, cooldown suppression, and a support investigation runbook.
- Added production-safe correlation and structured observability events across Telegram receipt, parsing, queue handoff, execution claiming, broker dispatch, and completion.
- Added cumulative histogram-compatible worker metrics for pipeline stage durations and event throughput.
- Added safe duration and redaction helpers for execution-pipeline observability.
- Added bounded, redacted Telegram connection tracing and AUTH_KEY_DUPLICATED recovery invalidation so users are prompted to reconnect after repeated duplicate-auth failures.

### Fixed

- Restored XAUUSD breakeven follow-up offsets to the signal-pip convention so metal stop-loss offsets use `0.01` price units per pip after staging/dev merges.
- Preserved existing range-layering execution as explicit `legacy` behavior so existing accounts, pending baskets, and signals are not silently converted to future Static or Dynamic semantics.
- Tightened Phase A layer-plan snapshot parsing so impossible persisted Static/Dynamic metadata fails closed instead of being silently repaired.
- Tightened Phase B calculator contracts so unrepresentable rounded anchors fail closed, lot allocation cannot exceed intended total, and combined plans expose funded prices separately from diagnostic candidates.
- Hardened Phase C layering-plan persistence with worker/service-role-only table access, timestamp-independent semantic idempotency, strict persisted lot-total invariants, status-aware recovery, and safer immutable update typing.
- Enforced Dynamic prepare-only as a no-send path because Dynamic plans require an actual broker fill and must not invent a quote or requested-price anchor.
- Hardened Static/Dynamic activation so the RPC derives executable legs only from persisted plan metadata, prepare-only capability responses report execution as unavailable, and layering settings saves go through an authenticated server-authoritative Edge Function.
- Tightened Static/Dynamic native-pending recovery so `submission_ambiguous` and `reconciliation_required` remain non-sendable until an exact broker-reference adoption or explicit manual recovery; lookup misses now stay in reconciliation/manual-review state.
- Fixed native-pending recovery ownership so crashed workers cannot permanently strand `reconciliation_claimed_by`; recovery leases expire, lookup outages release ownership for later startup passes, authoritative lookup misses move to `manual_review`, and later broker-reference matches can still be adopted after retryable outages without resending.
- Fixed native broker-pending cancellation convergence so cancellation reconciles broker state before `OrderClose`, preserves already-filled orders, adopts already-cancelled/rejected states, treats timeout as `cancellation_pending`, and avoids duplicate cancel requests during retries/restarts.
- Fixed Static/Dynamic first-fill activation durability by awaiting layering post-fill plan persistence/activation in the live-fast path instead of running it as lossy background work.
- Fixed layering capability/configuration gating so `LAYERING_MODES_EXECUTION_ENABLED=false` disables execution without hiding or blocking Static/Dynamic configuration when the account is otherwise allowlisted and mode-enabled.
- Removed hardcoded load/scale-test credentials from scripts and environment examples. The previously committed staging Supabase service-role key must still be rotated because Git history retains it.
- Enforced load-test broker simulator mode with a no-send broker adapter, stricter worker health capability preflight, normalized production URL rejection, confined load-test artifacts, dry-run cleanup by default, exact-run cleanup markers, and aggregate-only Section 6 synthetic setup.
- Increased Railway Telegram shutdown drain behavior to wait about 30 seconds, await all listener/auth disconnects, release owned session leases, and prevent reconnects from starting during shutdown.
- Patched GramJS RPC result handling to reject malformed or empty Telegram response bodies before BinaryReader decoding and trigger bounded listener reconnect recovery.
- Auto-disables Telegram channel subscriptions after repeated confirmed `CHANNEL_INVALID`/stale-username failures, records a safe reconnect-required event, and keeps healthy channel polling moving.

### Performance

- Added latency measurements for Telegram receipt, parsing, signal persistence, queue wait, execution planning, durable claims, broker readiness, broker requests, broker confirmation, and reconciliation-compatible summaries.
- Reduced virtual range-layer execution latency by removing duplicated stale-basket reconciliation from the pre-claim execution path.
- Moved the durable pending-leg claim earlier so only the winning worker performs safety checks and broker dispatch.
- Added an early trigger-band and slippage check before expensive database safety operations.
- Added structured latency measurements for pending-leg lookup, durable claim, crossing-to-broker dispatch, broker response, and total layer execution time.

### Fixed

- Replaced the ambiguous boolean result from range-layer execution with explicit `fired`, `skipped`, `not_claimed`, and `failed` outcomes.
- Prevented stale-basket cleanup from being incorrectly counted as a successfully fired layer.
- Ensured losing multi-worker claim attempts exit before broker calls or additional safety processing.
- Ensured slipped entries release only currently claimed legs and are not recorded as fired.

### Tests

- Added execution-pipeline observability tests for correlation propagation, safe duration handling, redaction, duplicate-prevention events, ambiguous-execution events, and metric/logging failure isolation.
- Added behavioral tests proving durable claims occur before stale-basket checks.
- Added tests confirming losing claimants perform no broker or safety work.
- Added tests for slipped-entry claim release.
- Added tests confirming successful layers dispatch only once.
- Added tests confirming stale-basket cleanup is skipped rather than recorded as fired.

## Changelog Guidelines

Every pull request that changes user-visible behaviour, execution logic, infrastructure, security, performance, database schemas, integrations, or operational behaviour must update the `Unreleased` section.

Entries should:
- explain the impact rather than only naming files;
- be concise and understandable to other developers;
- avoid implementation details that do not help operators or maintainers;
- be moved into a dated release section when deployed to production.

Small formatting-only changes and internal refactors with no behavioural impact may omit a changelog entry.
