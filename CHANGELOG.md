# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning where practical.

## [Unreleased]

### Added

- Added production-safe correlation and structured observability events across Telegram receipt, parsing, queue handoff, execution claiming, broker dispatch, and completion.
- Added cumulative histogram-compatible worker metrics for pipeline stage durations and event throughput.
- Added safe duration and redaction helpers for execution-pipeline observability.

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
