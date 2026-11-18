-- Apply: listener stall-heal alert rule + its index (incident 2026-11-18)
--
-- Run this file as-is. Every line is either SQL or a `--` comment, so it cannot
-- produce a syntax error the way pasted prose does.
--
-- BEFORE RUNNING: deploy the updated alert-evaluator function first. Without its
-- `case "listener_stall_heal"`, the rule is listed as "skipped: no evaluator"
-- and can never fire.
--
-- LOCKING: statement 1 is a plain CREATE INDEX, which blocks writes to
-- listener_events while it builds. On a busy table run it in a quiet window, or
-- build it out of band first and then run this file (the IF NOT EXISTS makes the
-- second run a no-op):
--
--   create index concurrently if not exists listener_events_type_created_idx
--     on public.listener_events (event_type, created_at desc);
--
-- This file is idempotent: it can be run more than once safely.


-- 1) Index the evaluator needs: equality on event_type, range on created_at.
create index if not exists listener_events_type_created_idx
  on public.listener_events (event_type, created_at desc);


-- 2) The alert rule. Re-running updates it instead of duplicating it.
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


-- 3) Bookkeeping row (this repo applies migrations by hand through the API).
insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261118120000', '20261118120000_listener_stall_heal_alert.sql', 'opencode')
on conflict (version) do nothing;


-- ---------------------------------------------------------------------------
-- CHECKS — run these separately after the statements above.
-- ---------------------------------------------------------------------------

-- The rule exists and is enabled (expect exactly one row, enabled = true).
-- select code, enabled, severity, window_minutes
-- from public.alert_rules
-- where code = 'listener_stall_heal';

-- The index exists (expect one row).
-- select indexname from pg_indexes
-- where tablename = 'listener_events'
--   and indexname = 'listener_events_type_created_idx';

-- Normal day: zero heals in the last 15 minutes.
-- select count(*) from public.listener_events
-- where event_type = 'listener_stall_heal'
--   and created_at > now() - interval '15 minutes';

-- The index is used, not a sequential scan (look for listener_events_type_created_idx).
-- explain (analyze, buffers)
-- select count(*) from public.listener_events
-- where event_type = 'listener_stall_heal'
--   and created_at > now() - interval '15 minutes';


-- ---------------------------------------------------------------------------
-- KILL SWITCH — do NOT run as part of the apply. Uncomment only to silence the
-- rule immediately, without a deploy or restart.
-- ---------------------------------------------------------------------------

-- update public.alert_rules set enabled = false, updated_at = now()
-- where code = 'listener_stall_heal';
