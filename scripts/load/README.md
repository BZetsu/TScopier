# Load Test Harness

Phase 1 provides safety hardening, deterministic synthetic input generation,
run isolation, cleanup helpers, and reporting for load-test scripts.

## Production Prohibition

Do not run these scripts against production workers, production Supabase,
production Redis, live brokers, or production Telegram sessions.

Important: a staging Supabase service-role key was previously committed in
`scripts/section6-scale-test.js`. Removing it from the current file does not
remove it from Git history. An authorized Supabase administrator must rotate
that key.

## Current Coverage

`burst-dispatch.mjs` sends deterministic synthetic `POST
/internal/dispatch-signal` requests to a trade-entry worker and reports HTTP
acceptance behavior. It does not simulate Telegram listener load, MTProto
errors, real broker behavior, Redis lag, Supabase failures, Railway deployment
overlap, or multi-hour soak chaos.

`../section6-scale-test.js` creates deterministic blank Telegram session rows
from aggregate shape configuration into an allowlisted isolated target.
Blank `session_string` rows test database/session-manager scale and invalid
session handling only. They do not test real Telegram connectivity.

## Required Safety Environment

All load scripts fail closed unless these are set:

```bash
LOAD_TEST_MODE=true
NODE_ENV=staging
LOAD_CLEANUP_POLICY=auto
LOAD_ALLOWED_HOSTS=isolated-worker.example.test
LOAD_ALLOWED_SUPABASE_PROJECT_REFS=abcdefghijklmnopqrst
```

Production hosts such as `sso.tscopier.ai`, `tscopier.ai`, `*.tscopier.ai`,
and the known production Supabase project ref are rejected.

## Broker Safety

`burst-dispatch.mjs` reaches the trade executor dispatch path, so it requires
the target worker `/health` response to prove the worker selected the enforced
in-memory broker simulator at startup:

```json
{
  "load_test_enabled": true,
  "broker_mode": "simulator",
  "live_broker_execution_enabled": false,
  "simulator_enforced": true,
  "environment": "staging"
}
```

The worker refuses to start with `LOAD_TEST_MODE=true` unless
`BROKER_SIMULATOR_MODE=true` is active, refuses simulator mode in production,
and refuses simulator startup when live broker credential variables are present.
No request payload can override broker mode. There is no override for live
broker tests.

## Burst Dispatch

```bash
LOAD_TEST_MODE=true \
NODE_ENV=staging \
LOAD_CLEANUP_POLICY=manual \
LOAD_ALLOWED_HOSTS=isolated-worker.example.test \
TRADE_WORKER_URL=https://isolated-worker.example.test \
WORKER_INTERNAL_TOKEN=from-env-only \
LOAD_RUN_ID=loadtest-demo-001 \
LOAD_USER_IDS=loadtest_user_770e62b672d413d58176103445412bfb_0001,loadtest_user_770e62b672d413d58176103445412bfb_0002 \
LOAD_SEED=demo-seed \
LOAD_SIGNAL_COUNT=100 \
LOAD_CONCURRENCY=5 \
node scripts/load/burst-dispatch.mjs
```

`LOAD_USER_IDS` must use the deterministic `loadtest_user_<run_hash>_<suffix>`
format generated for the same run ID. Optional report:

```bash
LOAD_REPORT_FILE=burst-loadtest-demo-001.json node scripts/load/burst-dispatch.mjs
```

The report includes attempted, accepted, rejected, wrong-shard, timeout,
network-failure, status distribution, p50/p95/p99/max latency, throughput, run
duration, run ID, seed, concurrency, target environment, and broker simulator
confirmation. Reports never include secrets or complete user payloads.

## Run ID And Seed

If `LOAD_RUN_ID` is omitted, a UUID is generated once at startup. Every
synthetic signal gets a deterministic `loadtest_signal_...` ID derived from the
run ID and sequence number. `LOAD_SEED` controls deterministic symbol, side, and
entry-price generation. Network scheduling is not deterministic.

## Limits

Hard ceilings:

- concurrency: 50
- signal count: 2,000
- runtime: 15 minutes
- request timeout: 30 seconds
- retries: 3
- users: 100
- payload size: 16 KiB

Invalid, negative, NaN, infinite, and oversized numeric values are rejected.

## Emergency Stop

Press `Ctrl+C` to stop scheduling new requests. You can also create the local
file configured by `LOAD_STOP_FILE`; the script only checks for that file before
scheduling each request and never creates, modifies, or deletes it. In-flight
requests are awaited with bounded per-request timeouts and a partial summary is
printed.

## Cleanup

Cleanup defaults to dry-run. Actual deletion requires `--confirm-delete` or
`LOAD_CLEANUP_CONFIRM=true`. Cleanup only targets deterministic synthetic rows
tagged by the exact run ID hash. It never deletes by broad date ranges and never
deletes untagged rows.

Burst cleanup:

```bash
LOAD_TEST_MODE=true \
NODE_ENV=staging \
LOAD_CLEANUP_POLICY=manual \
LOAD_ALLOWED_HOSTS=isolated-worker.example.test \
LOAD_ALLOWED_SUPABASE_PROJECT_REFS=abcdefghijklmnopqrst \
TRADE_WORKER_URL=https://isolated-worker.example.test \
WORKER_INTERNAL_TOKEN=from-env-only \
LOAD_USER_IDS=loadtest_user_demo_0001 \
LOAD_RUN_ID=loadtest-demo-001 \
LOAD_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co \
LOAD_SUPABASE_SERVICE_ROLE_KEY=from-env-only \
node scripts/load/burst-dispatch.mjs --cleanup-only --confirm-delete
```

Section 6 cleanup:

```bash
LOAD_TEST_MODE=true \
NODE_ENV=staging \
LOAD_CLEANUP_POLICY=manual \
LOAD_ALLOWED_SUPABASE_PROJECT_REFS=targetprojectref0002 \
TARGET_SUPABASE_URL=https://targetprojectref0002.supabase.co \
TARGET_SUPABASE_SERVICE_ROLE_KEY=from-env-only \
LOAD_RUN_ID=loadtest-demo-001 \
node scripts/section6-scale-test.js --cleanup-only --confirm-delete
```

If a table cannot be tied to `LOAD_RUN_ID` or an equivalent synthetic marker,
the cleanup code skips it rather than performing unsafe deletion.

## CI Smoke Profile

Use mocks only:

```bash
NODE_ENV=test node --test scripts/load/*.test.mjs
```

## Manual Isolated-Staging Profile

Use a dedicated staging/test Supabase project, a dedicated worker configured
with `LOAD_TEST_MODE=true` and `BROKER_SIMULATOR_MODE=true`, and synthetic
`LOAD_USER_IDS`. Do not set `FXSOCKET_API_KEY` or other live broker credential
variables on that worker. Keep `LOAD_CONCURRENCY` at or below `20` unless
deliberately testing the absolute ceiling.

## Section 6 Aggregate Shape

Section 6 no longer reads another Supabase project. Supply production shape as
aggregate counts only:

```bash
LOAD_TEST_MODE=true \
NODE_ENV=staging \
LOAD_CLEANUP_POLICY=manual \
LOAD_ALLOWED_SUPABASE_PROJECT_REFS=targetprojectref0002 \
TARGET_SUPABASE_URL=https://targetprojectref0002.supabase.co \
TARGET_SUPABASE_SERVICE_ROLE_KEY=from-env-only \
LOAD_RUN_ID=loadtest-demo-001 \
LOAD_USER_COUNT=53 \
LOAD_CHANNELS_PER_USER_MIN=2 \
LOAD_CHANNELS_PER_USER_MAX=4 \
LOAD_ACTIVE_SESSION_RATIO=1 \
LOAD_CHANNEL_TYPE_DISTRIBUTION=broadcast:8,group:2 \
LOAD_SEED=demo-seed \
node scripts/section6-scale-test.js
```

Future anonymized aggregate import should be implemented as a separate approved
feature. It must not read profiles, phone numbers, Telegram sessions, channel
names, broker connections, or other PII.

All JSON reports and manifests are written only under the repository
`load-results` directory. Absolute paths, traversal, drive-letter paths, UNC
paths, and existing files are rejected unless `LOAD_REPORT_OVERWRITE=true` is
explicitly set for an already-safe filename.
