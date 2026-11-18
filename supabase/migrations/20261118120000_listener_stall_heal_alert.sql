/*
  Alert rule + index: Telegram listeners that stopped reading channels.

  On 2026-11-18 two customers' copiers reported "connected" while receiving
  nothing for 82 minutes (user d5027e0c: last event 08:27, restart 10:01). The
  worker now detects that state and restarts the listener itself, recording
  `listener_stall_heal` in listener_events. That event is the only evidence a
  stall happened, so this rule turns it into a page instead of a row nobody
  reads:

    - `detail->>'healed' = 'false'` means the heal was REFUSED (hourly budget
      spent). The listener is deaf and we are deliberately not touching it for
      up to an hour — this must page.
    - Several heals inside the window means more than one account stopped at
      once, i.e. a platform-wide stall rather than a single account.

  Deploy alert-evaluator BEFORE applying this migration, otherwise the rule has
  no evaluator and is skipped as "no evaluator for rule".

  Severity: warning. Current alert recipients are critical-only, so a single
  refused heal is recorded and escalates; the escalation is what pages.
*/

-- OPERATIONAL NOTE: this is a plain (non-CONCURRENT) CREATE INDEX, matching repo
-- house style. It takes an exclusive lock on listener_events for the build, and
-- that table receives thousands of inserts an hour from the worker. Apply it in a
-- low-traffic window, or run the statement out of band first:
--   create index concurrently if not exists listener_events_type_created_idx
--     on public.listener_events (event_type, created_at desc);
-- The index is required: the evaluator counts by event_type across all users
-- every window, and without it each evaluation scans the whole table.
create index if not exists listener_events_type_created_idx
  on public.listener_events (event_type, created_at desc);

insert into public.alert_rules (
  code, name, description, severity, enabled, threshold, window_minutes, cooldown_seconds
)
values (
  'listener_stall_heal',
  'Telegram listener stalled (copier connected but receiving nothing)',
  'A customer''s Telegram listener stopped reading channels while still reporting itself as connected. The worker restarts such a listener automatically (see listener_events event_type listener_stall_heal). This alert fires when that repair was REFUSED because the per-listener hourly limit was already used — the copier is deaf and we are deliberately leaving it alone — or when several listeners had to be restarted in a short window, which points at a platform-wide stall rather than one account. Customers see no error in this state: the copier badge stays green while no signals arrive, so nobody reports it until they notice missing trades.',
  'warning',
  true,
  '{"refused_min": 1, "heals_min": 3, "escalations": [{"after_minutes": 30, "severity": "critical"}]}'::jsonb,
  15,
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
values ('20261118120000', '20261118120000_listener_stall_heal_alert.sql', 'opencode')
on conflict (version) do nothing;
