-- Apply: mtapi_old_version alert rule (incident 2026-11-19)
--
-- Run this file as-is in the Supabase SQL editor (postgres role). Every line is
-- either SQL or a `--` comment.
--
-- BEFORE RUNNING: deploy the updated alert-evaluator function first. Without its
-- `case "mtapi_old_version"`, the rule is listed as "skipped: no evaluator" and
-- can never fire — the exact silent failure this rule exists to catch.
--
-- NO INDEX NEEDED: the evaluator reads trade_execution_logs over a 10-minute
-- window, which is already covered by idx_trade_exec_logs_created_at
-- (created_at desc). Nothing here locks a hot table.
--
-- Idempotent: safe to run more than once.


-- 1) The alert rule. Re-running updates it instead of duplicating it.
insert into public.alert_rules (
  code, name, description, severity, enabled, threshold, window_minutes, cooldown_seconds
)
values (
  'mtapi_old_version',
  'MTAPI bridge too old — brokers refuse the manager login (OLD_VERSION)',
  'The MTAPI bridge (mt5rest) is running an MT5 Manager API build older than the minimum the brokers now accept, so opening the manager session returns ServerException OLD_VERSION and every order on that account is refused before it is sent. Accounts stay connected, keep streaming prices and keep reporting balances, so the app looks healthy while nothing can trade. Customers see "No position opened" (entry_not_opened), which looks like a parsing or broker-rejection problem. It fires on the first affected account because OLD_VERSION has no benign cause and nothing recovers on its own; brokers then apply the new minimum in waves, so the count usually grows from there. The only remedy is updating the bridge image (docker pull timurila/mt5rest + recreate through deploy/mtapi-log-redactor/install.sh) and verifying CheckConnect returns OK.',
  'critical',
  true,
  '{"max_accounts": 0, "max_rows": 6, "persistence_minutes": 5}'::jsonb,
  10,
  900
)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      severity = excluded.severity,
      enabled = excluded.enabled,
      threshold = excluded.threshold,
      window_minutes = excluded.window_minutes,
      cooldown_seconds = excluded.cooldown_seconds,
      updated_at = now();


-- 2) Bookkeeping row (this repo applies migrations by hand through the API).
insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261119120000', '20261119120000_mtapi_old_version_alert.sql', 'opencode')
on conflict (version) do nothing;


-- ---------------------------------------------------------------------------
-- CHECKS — run these separately after the statements above.
-- ---------------------------------------------------------------------------

-- The rule exists and is enabled (expect exactly one row, enabled = true,
-- severity = critical).
-- select code, enabled, severity, window_minutes, cooldown_seconds, threshold
-- from public.alert_rules
-- where code = 'mtapi_old_version';

-- It is wired to an evaluator: the deployed function must contain the dispatch
-- case. If the admin shows "skipped: no evaluator for rule mtapi_old_version",
-- the function was not deployed before the migration.

-- Normal day: zero refusals in the last 10 minutes.
-- select count(*), count(distinct broker_account_id)
-- from public.trade_execution_logs
-- where status = 'failed'
--   and error_message ilike '%OLD_VERSION%'
--   and created_at > now() - interval '10 minutes';

-- Historical replay of the 2026-11-19 incident (10-minute buckets, thresholds
-- max_accounts = 0, max_rows = 6). Verified output: the rule would have fired
-- in the 02:10 bucket — first refusal 02:16 — and paged ~02:21, five minutes
-- into the incident, instead of a warning at 08:55:
--
--   bucket | rows | accts | would_fire
--   02:10  |   1  |   1   | true
--   02:40  |  18  |   3   | true
--   02:50  |   2  |   1   | true
--   03:00  |   3  |   1   | true
--
-- with w as (
--   select date_trunc('minute', created_at)
--            - (extract(minute from created_at)::int % 10) * interval '1 minute' as bucket,
--          count(*) as rows,
--          count(distinct broker_account_id) as accts
--   from public.trade_execution_logs
--   where status = 'failed'
--     and error_message ilike '%OLD_VERSION%'
--     and created_at between '2026-11-19 02:00:00+00' and '2026-11-19 10:15:00+00'
--   group by 1
-- )
-- select bucket, rows, accts, (accts > 0 or rows > 6) as would_fire
-- from w order by bucket;


-- ---------------------------------------------------------------------------
-- KILL SWITCH — do NOT run as part of the apply. Uncomment only to silence the
-- rule immediately, without a deploy or restart.
-- ---------------------------------------------------------------------------

-- update public.alert_rules set enabled = false, updated_at = now()
-- where code = 'mtapi_old_version';
