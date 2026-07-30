# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning where practical.

## [Unreleased]

### Added

- Added fail-closed load-harness safety guards, deterministic synthetic signal generation, worker safety preflight, emergency stop support, cleanup helpers, and JSON run reporting.
- Added disabled-by-default, worker-only Sentry monitoring with all SDK default integrations disabled, defensive redaction, role/shard tags, bounded shutdown flushing, and targeted sanitized-helper capture for final Telegram, queue, broker, persistence, range-layer, reconciliation, and lifecycle failures.
- Added production-safe correlation and structured observability events across Telegram receipt, parsing, queue handoff, execution claiming, broker dispatch, and completion.
- Added cumulative histogram-compatible worker metrics for pipeline stage durations and event throughput.
- Added safe duration and redaction helpers for execution-pipeline observability.
- Added bounded, redacted Telegram connection tracing and AUTH_KEY_DUPLICATED recovery invalidation so users are prompted to reconnect after repeated duplicate-auth failures.

### Fixed

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
