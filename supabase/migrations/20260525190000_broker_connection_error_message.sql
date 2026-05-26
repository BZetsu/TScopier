-- Persist last connection failure reason for user-facing broker reconnect messaging.

alter table public.broker_accounts
  add column if not exists connection_error_kind text;

alter table public.broker_accounts
  add column if not exists connection_error_message text;

comment on column public.broker_accounts.connection_error_kind is
  'Classified connect failure: wrong_password, wrong_login, wrong_server, investor_password, account_disabled, session_expired, unknown.';

comment on column public.broker_accounts.connection_error_message is
  'User-facing explanation of the last connect/reconnect failure. Cleared when connected.';

grant select (
  connection_error_kind,
  connection_error_message
) on table public.broker_accounts to authenticated;

-- Keep credential guard from stripping error fields on client writes.
create or replace function public.broker_accounts_guard_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mt_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.connection_error_kind := null;
    new.connection_error_message := null;
  elsif tg_op = 'UPDATE' then
    new.mt_password_encrypted := old.mt_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.connection_error_kind := old.connection_error_kind;
    new.connection_error_message := old.connection_error_message;
  end if;

  return new;
end;
$$;
