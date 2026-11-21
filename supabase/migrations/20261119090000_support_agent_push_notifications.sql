/*
  Expo push tokens for support agents + triggers that notify via support-push edge function.

  Requires vault secrets (same as other cron jobs):
    - supabase_url  = https://<ref>.supabase.co
    - service_role_key
*/

create extension if not exists pg_net;

create table if not exists public.support_agent_push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text,
  device_name text,
  updated_at timestamptz not null default now(),
  primary key (user_id, expo_push_token)
);

create index if not exists support_agent_push_tokens_token_idx
  on public.support_agent_push_tokens (expo_push_token);

comment on table public.support_agent_push_tokens is
  'Expo push tokens for support-admin mobile agents.';

alter table public.support_agent_push_tokens enable row level security;

drop policy if exists "Agents manage own push tokens" on public.support_agent_push_tokens;
create policy "Agents manage own push tokens"
  on public.support_agent_push_tokens
  for all
  to authenticated
  using (auth.uid() = user_id and public.is_support_agent())
  with check (auth.uid() = user_id and public.is_support_agent());

drop policy if exists "Service role full access push tokens" on public.support_agent_push_tokens;
create policy "Service role full access push tokens"
  on public.support_agent_push_tokens
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.upsert_support_push_token(
  p_token text,
  p_platform text default null,
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_support_agent() then
    raise exception 'Not a support agent';
  end if;
  if p_token is null or length(trim(p_token)) < 10 then
    raise exception 'Invalid push token';
  end if;

  insert into public.support_agent_push_tokens as t (
    user_id, expo_push_token, platform, device_name, updated_at
  )
  values (
    auth.uid(),
    trim(p_token),
    nullif(trim(coalesce(p_platform, '')), ''),
    nullif(trim(coalesce(p_device_name, '')), ''),
    now()
  )
  on conflict (user_id, expo_push_token) do update
    set platform = excluded.platform,
        device_name = excluded.device_name,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_support_push_token(text, text, text) from public, anon;
grant execute on function public.upsert_support_push_token(text, text, text) to authenticated;

create or replace function public.delete_support_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from public.support_agent_push_tokens
  where user_id = auth.uid()
    and expo_push_token = trim(p_token);
end;
$$;

revoke all on function public.delete_support_push_token(text) from public, anon;
grant execute on function public.delete_support_push_token(text) to authenticated;

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

  if v_url is null or v_url not like '%.supabase.co%' then
    select nullif(trim(decrypted_secret), '') into v_url
    from vault.decrypted_secrets
    where name = 'supabase_url'
      and decrypted_secret like '%.supabase.co%'
    limit 1;
  end if;

  if v_key is null then
    select nullif(trim(decrypted_secret), '') into v_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
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

create or replace function public.trg_support_push_on_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.sender_type = 'user' then
    perform public.invoke_support_push(jsonb_build_object(
      'event', 'chat_message',
      'title', 'New chat message',
      'body', left(coalesce(nullif(trim(new.body), ''), 'Customer sent a message'), 140),
      'data', jsonb_build_object(
        'type', 'chat',
        'conversationId', new.conversation_id,
        'messageId', new.id
      )
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists support_push_on_message on public.support_messages;
create trigger support_push_on_message
  after insert on public.support_messages
  for each row execute function public.trg_support_push_on_message();

create or replace function public.trg_support_push_on_ticket()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.invoke_support_push(jsonb_build_object(
    'event', 'ticket_created',
    'title', 'New ticket',
    'body', left(coalesce(nullif(trim(new.subject), ''), 'A new support ticket was opened'), 140),
    'data', jsonb_build_object(
      'type', 'ticket',
      'ticketId', new.id,
      'number', new.number
    )
  ));
  return new;
end;
$$;

drop trigger if exists support_push_on_ticket on public.support_tickets;
create trigger support_push_on_ticket
  after insert on public.support_tickets
  for each row execute function public.trg_support_push_on_ticket();

create or replace function public.trg_support_push_on_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.sender_type in ('user', 'email_inbound') then
    perform public.invoke_support_push(jsonb_build_object(
      'event', 'ticket_message',
      'title', 'Ticket reply',
      'body', left(coalesce(nullif(trim(new.body), ''), 'New message on a ticket'), 140),
      'data', jsonb_build_object(
        'type', 'ticket',
        'ticketId', new.ticket_id,
        'messageId', new.id
      )
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists support_push_on_ticket_message on public.support_ticket_messages;
create trigger support_push_on_ticket_message
  after insert on public.support_ticket_messages
  for each row execute function public.trg_support_push_on_ticket_message();

create or replace function public.trg_support_push_on_flag()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_title text;
  v_type text;
begin
  if new.kind = 'issue' then
    v_title := 'New issue flagged';
    v_type := 'issue';
  else
    v_title := 'New suggestion flagged';
    v_type := 'suggestion';
  end if;

  perform public.invoke_support_push(jsonb_build_object(
    'event', 'flag_' || new.kind,
    'title', v_title,
    'body', left(coalesce(nullif(trim(new.message_body), ''), 'A message was flagged'), 140),
    'excludeUserId', new.marked_by_agent_id,
    'data', jsonb_build_object(
      'type', v_type,
      'flagId', new.id,
      'conversationId', new.conversation_id
    )
  ));
  return new;
end;
$$;

drop trigger if exists support_push_on_flag on public.support_message_flags;
create trigger support_push_on_flag
  after insert on public.support_message_flags
  for each row execute function public.trg_support_push_on_flag();

create or replace function public.trg_support_push_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_body text;
begin
  if new.skipped then
    v_body := 'Customer skipped CSAT feedback';
  elsif new.rating is not null then
    v_body := 'CSAT ' || new.rating::text || '/5'
      || case
           when nullif(trim(coalesce(new.comment, '')), '') is not null
             then ': ' || left(trim(new.comment), 100)
           else ''
         end;
  else
    v_body := 'New customer feedback';
  end if;

  perform public.invoke_support_push(jsonb_build_object(
    'event', 'feedback',
    'title', 'New feedback',
    'body', v_body,
    'data', jsonb_build_object(
      'type', 'feedback',
      'feedbackId', new.id,
      'conversationId', new.conversation_id
    )
  ));
  return new;
end;
$$;

drop trigger if exists support_push_on_feedback on public.support_conversation_feedback;
create trigger support_push_on_feedback
  after insert on public.support_conversation_feedback
  for each row execute function public.trg_support_push_on_feedback();
