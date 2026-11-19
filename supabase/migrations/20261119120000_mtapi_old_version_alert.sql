/*
  Alert rule: the MTAPI bridge's MT5 Manager API build is below the broker minimum.

  2026-11-19: every MT5 account on the bridge started failing in waves, from
  02:16 to 09:53 UTC, with the broker refusing `MT5API.Connect()` as
  `ServerException: OLD_VERSION`. The `mt5rest` container runs no MetaTrader
  terminal — it logs in to each broker's trade server with the MT5 Manager API
  client bundled in the image. The running image was the 10 Sep build while the
  vendor had published newer builds (including ten on the day of the incident),
  so every broker that had raised its minimum accepted build refused it.

  The customer-visible symptom is "No position opened" / `entry_not_opened`,
  which reads like a parser bug or a broker rejection and hides the cause. It
  took 58 failed signals across 18 users and 8 hours before `executions_failing`
  reached its *warning* threshold, so this needs its own critical rule.

  Thresholds:
    - max_accounts 0  → the FIRST refused account pages. OLD_VERSION has no
      benign cause and nothing self-heals, and the incident's first 24 minutes
      were a single account (JustMarkets, 02:16) before the rest followed.
    - max_rows 6      → covers rows that arrive without a broker_account_id.
    - persistence_minutes 5 → the condition is bursty (true only while refusals
      sit inside the trailing window). Without a hold, a quiet ten-minute gap
      resolves the event, emails "recovered", and the cooldown then mutes the
      re-fire while orders are still being refused.

  Deploy alert-evaluator BEFORE applying this migration, otherwise the rule has
  no evaluator and is skipped as "no evaluator for rule".

  Severity: critical. Every order on an affected account is refused, the
  accounts still show as connected, and nothing recovers without updating the
  bridge image.
*/

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

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261119120000', '20261119120000_mtapi_old_version_alert.sql', 'opencode')
on conflict (version) do nothing;
