/*
  Per-rule alert recipients.

  alert_recipients could only say "this address gets everything at or above
  severity X". That is fine for the two ops addresses, but it means anyone added
  for one specific rule also receives every other critical page.

  rule_codes narrows an address to the listed rules. NULL or an empty array keeps
  the old behaviour (every rule), so existing rows need no backfill and the
  evaluator still works against a database without this column.

  Alex is added for provider-capacity alerts only: OpenAI out of credit or key
  rejected, and Cerebras refused for quota or a rejected key.
*/

alter table public.alert_recipients
  add column if not exists rule_codes text[];

comment on column public.alert_recipients.rule_codes is
  'When set and non-empty, this address receives only these rule codes. NULL or empty means every rule.';

insert into public.alert_recipients (email, enabled, min_severity, rule_codes)
values (
  'alex@tartarix.com',
  true,
  'critical',
  array['openai_credits_exhausted', 'openai_key_invalid', 'cerebras_key_invalid']
)
on conflict (email) do update
  set enabled = excluded.enabled,
      min_severity = excluded.min_severity,
      rule_codes = excluded.rule_codes;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261116130000', '20261116130000_alert_recipient_rule_targeting.sql', 'opencode')
on conflict (version) do nothing;
