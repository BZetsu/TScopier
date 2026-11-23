-- Track email delivery for recovery codes.
--
-- Adds sent_at / sent_email / email_subject so the admin can see which codes
-- were emailed, to what address, and when. Used by the admin import + send
-- flow (tscopier-admin /admin/recovery-codes).

alter table public.subscription_recovery_codes
  add column if not exists sent_at timestamptz,
  add column if not exists sent_email text,
  add column if not exists email_subject text;

create index if not exists subscription_recovery_codes_sent_idx
  on public.subscription_recovery_codes (sent_at desc nulls last);

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values (
  '20261123010000',
  '20261123010000_recovery_code_email_tracking',
  array['-- 20261123010000_recovery_code_email_tracking']::text[],
  'opencode-controlled-apply'
)
on conflict (version) do nothing;
