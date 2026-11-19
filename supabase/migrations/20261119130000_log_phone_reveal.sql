-- Revealing a customer's full Telegram number is a deliberate act by staff, so it is
-- recorded. `admin_audit_logs` has no INSERT policy (rows come from table triggers),
-- so the reveal goes through this SECURITY DEFINER function, which checks the caller
-- is an admin and writes the audit row itself.
--
-- The numbers themselves are read from telegram_sessions / telegram_auth_pending,
-- both of which already have "Admins can view all …" SELECT policies, so the data is
-- protected by RLS regardless of what the UI does.

create or replace function public.log_phone_reveal(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.admin_audit_logs (
    actor_user_id,
    target_user_id,
    action,
    entity_type,
    entity_id,
    request_payload
  )
  values (
    auth.uid(),
    p_target_user_id,
    'reveal_telegram_phone',
    'user',
    p_target_user_id::text,
    jsonb_build_object('field', 'telegram_phone')
  );
end;
$$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default, and
-- `revoke ... from public` does not remove an explicit anon grant. Revoke it so only
-- signed-in staff can call this; `is_admin()` would refuse anon anyway, but the
-- surface should not exist.
revoke all on function public.log_phone_reveal(uuid) from public;
revoke all on function public.log_phone_reveal(uuid) from anon;
grant execute on function public.log_phone_reveal(uuid) to authenticated;

comment on function public.log_phone_reveal(uuid) is
  'Records that an admin revealed a customer''s full Telegram phone number in the admin board.';
