/*
  Alert rule: support notifications are not being sent.

  support-notify moves each new ticket, reopened ticket and human request from
  support_notification_outbox to email on a one-minute schedule. If its key is
  wrong, its sender is rejected or its job stops, the outbox just fills up and
  the team is never told — the one failure mode that also silences the warning
  about itself. The alert-evaluator rule `support_notify_backlog` watches the
  unsent rows, so this page arrives through a separate path from the thing it is
  reporting on.

  Severity: starts at warning and escalates to critical after 30 minutes of a
  stuck queue. The current alert recipients are set to critical-only, so the
  escalation is what reaches them; a queue that is merely late by a minute or
  two never pages. Lower `min_severity` on alert_recipients if every warning
  should arrive immediately.

  Deploy alert-evaluator before applying this rule, otherwise the rule has no
  evaluator and is skipped as "no evaluator for rule".
*/

insert into public.alert_rules (
  code, name, description, severity, enabled, threshold, window_minutes, cooldown_seconds
)
values (
  'support_notify_backlog',
  'Support notifications not being sent',
  'Support notification emails have been waiting in the outbox longer than allowed. New tickets, reopened tickets and customers asking for a human are not reaching the team by email, even though they are still visible in the support desk. Usual causes: the support-notify function failing (wrong service key, a Resend rejection) or its scheduled job having stopped. Nothing is lost — the waiting rows send once the cause is fixed — but nobody is being told in the meantime.',
  'warning',
  true,
  '{"max_wait_minutes": 30, "escalations": [{"after_minutes": 30, "severity": "critical"}]}'::jsonb,
  5,
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
values ('20261116160000', '20261116160000_support_notify_backlog_rule.sql', 'opencode')
on conflict (version) do nothing;
