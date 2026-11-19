/*
  Alert rule for the Cerebras API key.

  Cerebras parses the majority of signals, so a rejected or missing key quietly
  degrades parsing to the slower OpenAI path and then the regex parser — the
  product keeps working while quality drops, with no other outward sign. This
  rule pages on exactly that, the same way openai_key_invalid does.

  The probe that feeds it is written by the alert-evaluator
  (system_probe_state target 'cerebras_api'). Deploy that function before
  applying this rule, otherwise the rule has no evaluator and is skipped as
  "no evaluator for rule".

  Critical, 60s grace so a single network blip does not page, 5-minute cooldown.
  Covers quota/payment refusals as well as a rejected key, because either one
  means Cerebras cannot parse and the traffic silently moves to the fallback.
*/

insert into public.alert_rules (
  code, name, description, severity, enabled, threshold, window_minutes, cooldown_seconds
)
values (
  'cerebras_key_invalid',
  'Cerebras unusable (key rejected or out of quota)',
  'Cerebras is refusing requests: the API key is rejected (HTTP 401/403), the account is out of credit or over its plan quota (HTTP 402 payment_required, or a 429 daily token limit), or CEREBRAS_API_KEY is not set on the alert-evaluator. Cerebras handles most signal parsing, so while this fires parsing falls back to OpenAI on every affected request and complex signals may be skipped.',
  'critical',
  true,
  '{"grace_seconds": 60}'::jsonb,
  1,
  300
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
values ('20261116120000', '20261116120000_cerebras_alert_rule.sql', 'opencode')
on conflict (version) do nothing;
