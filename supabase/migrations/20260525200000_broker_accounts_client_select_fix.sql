-- Fix broker list not loading: column-only SELECT grants break PostgREST `.select('*')`.
-- Restore table-level SELECT for authenticated clients, then hide ciphertext only.

grant select on table public.broker_accounts to authenticated;

revoke select (mt_password_encrypted) on table public.broker_accounts from authenticated;

comment on column public.broker_accounts.mt_password_encrypted is
  'AES-256-GCM ciphertext of MT password. SELECT revoked for authenticated; service_role only.';
