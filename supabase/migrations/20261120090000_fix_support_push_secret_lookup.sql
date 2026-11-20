/*
  Align invoke_support_push secret resolution with support-notify:
  app.settings → public.app_secrets → vault.decrypted_secrets.
  Vault lookups are wrapped so a vault permission error cannot abort the call.
*/

create or replace function public.invoke_support_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, net, vault
as $$
declare
  v_url text;
  v_key text;
begin
  v_url := nullif(trim(coalesce(current_setting('app.settings.supabase_url', true), '')), '');
  v_key := nullif(trim(coalesce(current_setting('app.settings.service_role_key', true), '')), '');

  if v_url is null and to_regclass('public.app_secrets') is not null then
    begin
      select nullif(trim(value), '') into v_url
      from public.app_secrets where key = 'supabase_url';
    exception when others then null;
    end;
  end if;

  if v_key is null and to_regclass('public.app_secrets') is not null then
    begin
      select nullif(trim(value), '') into v_key
      from public.app_secrets where key = 'service_role_key';
    exception when others then null;
    end;
  end if;

  if v_url is null or v_url not like '%.supabase.co%' then
    begin
      select nullif(trim(decrypted_secret), '') into v_url
      from vault.decrypted_secrets
      where name = 'supabase_url'
        and decrypted_secret like '%.supabase.co%'
      limit 1;
    exception when others then null;
    end;
  end if;

  if v_key is null then
    begin
      select nullif(trim(decrypted_secret), '') into v_key
      from vault.decrypted_secrets
      where name = 'service_role_key'
      limit 1;
    exception when others then null;
    end;
  end if;

  if v_url is null or v_key is null then
    raise notice 'invoke_support_push skipped: missing supabase_url or service_role_key';
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/support-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := payload,
    timeout_milliseconds := 8000
  );
exception
  when others then
    raise notice 'invoke_support_push failed: %', sqlerrm;
end;
$$;

revoke all on function public.invoke_support_push(jsonb) from public, anon, authenticated;
grant execute on function public.invoke_support_push(jsonb) to service_role;
