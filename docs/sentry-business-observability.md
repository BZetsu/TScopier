# Worker Sentry Business Observability

This worker emits two kinds of Sentry signal:

- Exceptions: uncaught failures, fatal startup/shutdown problems, invariant breaks, and unexpected persistence/reconciliation exceptions.
- Business issues: expected but user-impacting operational outcomes such as skipped copies, broker rejections, disconnected accounts, Telegram recovery exhaustion, failed management operations, ambiguous layering, queue dead letters, and broker-success/database-failure cases.

Sentry complements worker logs and database audit rows. It does not replace `trade_execution_logs`, broker state, reconciliation jobs, or support runbooks.

## Structured Logs

Issues (above) are for final failures. In addition, the worker streams **structured logs** to the Sentry Logs pipeline through the sanitized `captureWorkerLog` helper (`worker/src/observability/sentry.ts`) and the structured `logger` (`worker/src/logger.ts`, which forwards through it). Logs are fire-and-forget, pass `safeForSentry` at capture and `beforeSendLog` before leaving the process, and are queryable by their attributes: `subsystem`, `operation`, `error_code`, and the worker-role/shard fields.

- Log level gates: `SENTRY_LOGS_MIN_LEVEL=info|warn|error` (default `info`). Set `warn` to cut volume.
- Every worker process emits one `worker startup` log (`subsystem=worker`, `operation=startup`), proving Sentry connectivity within ~5s of boot.
- Keep out of log volume just like issues: price ticks, normal queue polling, successful trades/management, normal reconnect heartbeats, and transient retries that later succeed. Prefer a `warn`/`error` log for operator-relevant stage context and reserve issues for final failures.

## Categories

Business issue categories are bounded: `trade`, `broker`, `telegram`, `copier`, `account`, `queue`, `persistence`, `layering`, `management`, `reconciliation`, `auth`, and `worker`.

Severity rules:

- `info`: operator-relevant but no user impact.
- `warning`: delayed, skipped, or partial outcomes that may self-heal or be expected.
- `error`: failed or ambiguous user action requiring investigation.
- `fatal`: process-level fatal paths only.

User impact values are `none`, `delayed`, `skipped`, `partial`, `failed`, and `manual_review_required`.

## Event Names

Event names are stable and machine-searchable. Current worker events include:

- Trade/account: `trade_copy_blocked`, `trade_copy_failed`, `trade_copy_partial`, `broker_order_rejected`, `broker_order_ambiguous`, `broker_success_persistence_failed`, `broker_account_unavailable`.
- Telegram/copier: `telegram_listener_failed`, `telegram_recovery_exhausted`, `telegram_channel_auto_disabled`.
- Management: `trade_management_failed`, `trade_management_partial`, `stop_loss_update_failed`, `take_profit_update_failed`.
- Deferred trade follow-up: `post_fill_follow_up_failed`, `basket_tp_sync_failed`, `trade_management_cleanup_failed`, `deferred_trade_follow_up_failed`, `broker_success_persistence_failed`.
- Layering/reconciliation: `layering_plan_invalid`, `layering_plan_activation_failed`, `layering_leg_execution_failed`, `layering_materialization_failed`, `layering_native_reconciliation_required`, `layering_manual_review_required`, `layering_cancellation_pending`.
- Queue/persistence: `signal_queue_dead_lettered`, `signal_dispatch_failed`, `reconciliation_failed`.

Dynamic identifiers such as user IDs, signal IDs, broker account IDs, trade IDs, and layer plan IDs are never part of event names.

## Searchable Fields

Use Sentry tags for bounded fields:

- `event_category`
- `event_name`
- `reason_code`
- `user_impact`
- `operation`
- `subsystem`

Use event context for high-cardinality correlation:

- `user_hash` / `user_id_hash`
- `broker_account_id_hash`
- `signal_id`
- `telegram_message_id`
- `channel_row_id`
- `trade_id`
- `execution_attempt_id`
- `queue_message_id`
- `pending_leg_id`
- `layer_plan_id`
- `layer_step_idx`
- `basket_id`
- `symbol`
- `side`
- `execution_mechanism`
- latency durations from `pipeline_ts`

## Grouping

Business issue fingerprints group by stable operational cause:

- event name
- operation
- reason code
- broker/provider when available
- execution mechanism when relevant

Fingerprints intentionally exclude user ID, signal ID, trade ID, broker account ID, queue message ID, and layer plan ID so one outage or broker failure becomes one Sentry issue instead of one issue per user.

## Rate Limiting

Business events use bounded in-memory cooldown suppression. The first matching event is captured; repeated identical category/event/reason/operation/provider/mechanism events are suppressed until the cooldown expires.

Defaults:

```env
SENTRY_BUSINESS_EVENTS_ENABLED=true
SENTRY_BUSINESS_EVENT_COOLDOWN_MS=300000
```

Business events still require `SENTRY_ENABLED=true` and a valid `SENTRY_DSN`. Invalid cooldown values fall back to five minutes. Manual-review and fatal events bypass cooldown so ambiguous exposure is not hidden.

## Redaction

The worker prefers allowlisted context fields and redacts nested data before sending. Do not pass raw database rows, complete Telegram messages, complete signal payloads, complete broker payloads, complete `LayeringPlanSnapshot` JSON, credentials, balances, equity, free margin, request bodies, or response bodies.

The sanitizer redacts access tokens, JWTs, authorization headers, API keys, broker credentials, Telegram session strings/auth keys, phone numbers, email addresses, BVN/NIN/identity numbers, bank/account numbers, passwords, cookies, service-role keys, private keys, nested/circular values, and secret-looking URL query values.

## Performance Guarantees

Business capture is fire-and-forget. Hot paths do not await Sentry, flush Sentry, install HTTP/fetch instrumentation, add tracing headers, or serialize large arbitrary payloads before broker operations.

Keep out of Sentry event volume:

- price ticks and quote polling
- normal queue polling
- successful trades and successful management operations
- normal reconnect heartbeats
- transient retries that later succeed
- expected duplicate prevention

## Deferred Failure Capture Points

Deferred captures are emitted only after a background or follow-up operation has finally failed and the main trade outcome must remain unchanged. Current capture points include:

- `worker/src/tradeExecutor/orderLegExecution.ts`: live-fast trade row persistence, deferred broker-pending materialization, deferred virtual materialization, post-fill SL/TP follow-up, and multi-leg basket TP sync.
- `worker/src/tradeExecutor/virtualPendingMaterialize.ts`: final virtual pending row persistence failure.
- `worker/src/tradeExecutor/materializeBrokerRangePendingLegs.ts`: broker-pending row persistence failure after broker orders were placed.
- `worker/src/tradeExecutor/TradeExecutor.ts`: deferred virtual materialization persistence failure.
- `worker/src/tradeExecutor/managementExecutor.ts`: deferred close/pending cleanup failure and partial management outcomes.
- `worker/src/virtualPendingMonitor.ts` and `worker/src/rangeBrokerPendingMonitor.ts`: layer execution final failure, broker-success/DB-failure, post-naked SL/TP failure, range fill follow-up failure, TP rebalance failure, and reconcile enqueue failure.
- `worker/src/rangeBasketTpSync.ts`: basket SL/TP sync failures after retry.

Reason codes are stable, for example `VIRTUAL_MATERIALIZATION_FAILED`, `BROKER_PENDING_MATERIALIZATION_FAILED`, `POST_FILL_SL_UPDATE_FAILED`, `POST_FILL_TP_UPDATE_FAILED`, `BASKET_TP_SYNC_FINAL_FAILURE`, `MGMT_CLOSE_CLEANUP_FAILED`, `BROKER_SUCCESS_DB_FAILURE`, `BROKER_PENDING_FILL_DB_FAILURE`, and `RANGE_LEG_FIRE_FAILED`.

Partial outcomes use `user_impact=partial` or `manual_review_required` and include bounded counts such as `targeted_count`, `successful_count`, `failed_count`, `skipped_already_compliant_count`, and `broker_database_state_may_disagree`. Successful follow-ups and already-compliant SL/TP updates do not emit issues.

Each final deferred failure path should emit one Sentry issue through the business-event helper. If a generic worker warning is useful for stage context, use a log line or breadcrumb; do not pair a generic Sentry issue with a business issue for the same failed follow-up. The virtual pending reconcile-enqueue path follows this rule by keeping `deferred_trade_follow_up_failed` and removing the overlapping generic worker issue.

## Copier Health Events

Copier-health business events are emitted only for meaningful user impact:

- `copier_engine_offline`
- `telegram_listener_failed`
- `telegram_recovery_exhausted`
- `listener_ownership_lost`
- `listener_health_stale`

Temporary reconnects, watchdog probes, lease renewals, and reconnects that succeed within the grace window are not issue events. Offline health alerts are cooldown-limited by stable reason/category, not by user-specific identifiers.

Use breadcrumbs for stage context such as signal receipt, parsing, queue consumption, durable claim acquisition, broker request start/response, retry scheduling, reconnect requests, and reconciliation start.

## Support Flow: "My Trade Did Not Copy"

1. Search Sentry for the hashed user or broker-account identifier if available.
2. Filter `event_category:trade` or `event_category:account`.
3. Add `signal_id:<example-signal-id>` or `trade_id:<example-trade-id>` when known.
4. Read `reason_code` and `user_impact`.
5. Follow breadcrumbs and context:
   - Telegram receipt
   - queue or HTTP dispatch
   - validation/account readiness
   - broker request start
   - broker response
   - persistence/reconciliation
6. Classify the outcome:
   - blocked before send
   - broker rejected
   - broker timed out or ambiguous
   - broker succeeded but DB persistence failed
   - partial account/leg execution

Example searches:

```text
event_category:trade reason_code:INSUFFICIENT_MARGIN
event_name:broker_account_unavailable user_impact:skipped
signal_id:example-signal-id
event_name:broker_success_persistence_failed user_impact:manual_review_required
```

## Deployment And Rollback

Enable only on worker services:

```env
SENTRY_ENABLED=true
SENTRY_DSN=<worker project dsn>
SENTRY_ENVIRONMENT=production
SENTRY_BUSINESS_EVENTS_ENABLED=true
SENTRY_BUSINESS_EVENT_COOLDOWN_MS=300000
```

Rollback/disable without code changes:

```env
SENTRY_BUSINESS_EVENTS_ENABLED=false
```

Set `SENTRY_ENABLED=false` to disable all worker Sentry events. Load-test workers remain disabled by default unless `SENTRY_LOAD_TEST_ENABLED=true` is explicitly set for an isolated test project.

Expected volume is low: one event per final/exhausted operational outcome after cooldown, not per success, tick, poll, heartbeat, or normal retry.
