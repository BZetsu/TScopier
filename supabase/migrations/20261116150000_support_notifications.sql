-- Support notifications: one email per support event.
--
-- Why this exists
--   The support desk app already rings inside the browser while an agent has it
--   open. Nothing tells anyone when nobody is looking, so a ticket can wait for
--   hours (ticket #2, 2026-11-16).
--
-- How it works
--   Triggers write one row into support_notification_outbox for each event that
--   needs attention. A cron job calls the `support-notify` edge function every
--   minute; that function reads the pending rows, emails the recipients and
--   marks each row sent (or retries with backoff).
--
--   Triggers never call the network, so a notification problem can never break
--   ticket creation. Every trigger body is wrapped so an enqueue failure is
--   logged as a warning and the user's request still succeeds.
--
-- Events
--   ticket_created  — any new ticket: signed-in user, guest in the widget, or
--                     inbound email to support@.
--   ticket_reopened — a customer replied on a resolved or closed ticket.
--   chat_queued     — a live chat moved to 'queued' (customer asked for a human).
--
-- Recipients live in support_notification_recipients and are separate from
-- alert_recipients on purpose: system alerts are filtered by severity
-- (both current recipients are critical-only), support notifications are not.
--
-- DEPLOY ORDER (matters)
--   1. apply this migration            (adds support_tickets.source)
--   2. deploy support-notify
--   3. redeploy support-ticket-inbound (writes source = 'email')
--   4. insert the recipient addresses
-- Both functions read or write support_tickets.source, so deploying either one
-- before this migration turns inbound email into a 500.
--
-- While the recipient list is empty the notifier defers events (30-minute
-- backoff) instead of discarding them, so the first configured address receives
-- the tickets that arrived in the meantime.

-- 1. Where a ticket came from -------------------------------------------------
-- Inbound email and the widget both write guest fields, so the source is
-- recorded explicitly. Existing rows are app tickets.

alter table public.support_tickets
  add column if not exists source text not null default 'app';

-- Normalise anything unexpected before the constraint is validated, so a
-- pre-existing column cannot abort the whole migration.
update public.support_tickets
  set source = 'app'
  where source is null or source not in ('app', 'email');

alter table public.support_tickets
  drop constraint if exists support_tickets_source_check;

alter table public.support_tickets
  add constraint support_tickets_source_check check (source in ('app', 'email'));

comment on column public.support_tickets.source is
  'Where the ticket came from: app (support widget, signed-in user or guest) or email (inbound message to support@).';

-- 2. Recipients ---------------------------------------------------------------

create table if not exists public.support_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.support_notification_recipients is
  'People who receive support notifications (new ticket, reopened ticket, customer waiting for a human).';

-- 3. Outbox -------------------------------------------------------------------

create table if not exists public.support_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ticket_created', 'ticket_reopened', 'chat_queued')),
  event_key text not null unique,
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  conversation_id uuid references public.support_conversations(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists support_notification_outbox_pending_idx
  on public.support_notification_outbox (next_attempt_at)
  where sent_at is null;

create index if not exists support_notification_outbox_created_idx
  on public.support_notification_outbox (created_at desc);

comment on table public.support_notification_outbox is
  'One row per support event to notify about. event_key makes enqueue idempotent. sent_at NULL = still to send; the support-notify function retries with backoff.';
comment on column public.support_notification_outbox.failed_at is
  'Set when the normal retry budget is exhausted. The row stays unsent and keeps retrying every 6 hours, so a long email outage never loses a support alert.';

-- 4. Enqueue functions --------------------------------------------------------
-- SECURITY DEFINER so a signed-in user inserting their own ticket can write the
-- outbox row without a grant on the table. Each one swallows its own errors.

create or replace function public.enqueue_support_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.support_notification_outbox (kind, event_key, ticket_id)
  values ('ticket_created', 'ticket:' || new.id::text, new.id)
  on conflict (event_key) do nothing;
  return new;
exception
  when others then
    raise warning 'support notification enqueue (ticket_created) failed: %', sqlerrm;
    return new;
end;
$$;

create or replace function public.enqueue_support_ticket_reply_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if new.sender_type not in ('user', 'email_inbound') then
    return new;
  end if;

  -- The inbound handler inserts the message first and reopens the ticket after,
  -- so at this point the ticket still carries its previous status.
  select status into v_status
  from public.support_tickets
  where id = new.ticket_id;

  if v_status in ('resolved', 'closed') then
    insert into public.support_notification_outbox (kind, event_key, ticket_id)
    values ('ticket_reopened', 'message:' || new.id::text, new.ticket_id)
    on conflict (event_key) do nothing;
  end if;
  return new;
exception
  when others then
    raise warning 'support notification enqueue (ticket_reopened) failed: %', sqlerrm;
    return new;
end;
$$;

create or replace function public.enqueue_support_chat_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'queued' and coalesce(old.status, '') <> 'queued' then
    insert into public.support_notification_outbox (kind, event_key, conversation_id)
    values (
      'chat_queued',
      'conversation:' || new.id::text || ':' || gen_random_uuid()::text,
      new.id
    )
    on conflict (event_key) do nothing;
  end if;
  return new;
exception
  when others then
    raise warning 'support notification enqueue (chat_queued) failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists support_tickets_notify_created on public.support_tickets;
create trigger support_tickets_notify_created
  after insert on public.support_tickets
  for each row execute function public.enqueue_support_ticket_notification();

drop trigger if exists support_ticket_messages_notify_reply on public.support_ticket_messages;
create trigger support_ticket_messages_notify_reply
  after insert on public.support_ticket_messages
  for each row execute function public.enqueue_support_ticket_reply_notification();

drop trigger if exists support_conversations_notify_queued on public.support_conversations;
create trigger support_conversations_notify_queued
  after update of status on public.support_conversations
  for each row execute function public.enqueue_support_chat_notification();

-- Trigger functions return `trigger` and cannot be called directly, but the repo
-- convention is to revoke execute anyway (see the support chat migration).
revoke all on function public.enqueue_support_ticket_notification() from public, anon, authenticated;
revoke all on function public.enqueue_support_ticket_reply_notification() from public, anon, authenticated;
revoke all on function public.enqueue_support_chat_notification() from public, anon, authenticated;

-- 5. Access -------------------------------------------------------------------
-- Admins may read both tables for troubleshooting. Writes stay with the service
-- role (edge functions and the cron job); nobody else needs them.

alter table public.support_notification_recipients enable row level security;
alter table public.support_notification_outbox enable row level security;

drop policy if exists "Admins can view support_notification_recipients" on public.support_notification_recipients;
create policy "Admins can view support_notification_recipients"
  on public.support_notification_recipients for select to authenticated
  using (public.is_support_agent());

drop policy if exists "Admins can view support_notification_outbox" on public.support_notification_outbox;
create policy "Admins can view support_notification_outbox"
  on public.support_notification_outbox for select to authenticated
  using (public.is_support_agent());

-- 6. Cron: drain the outbox every minute -------------------------------------
-- Same credential lookup as the alert-evaluator job, so one pattern covers both
-- projects (app.settings, public.app_secrets, or Supabase Vault). The job only
-- posts when something is actually waiting.

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'support-notify';
  if v_jobid is not null then
    begin
      perform cron.unschedule(v_jobid);
    exception when others then null;
    end;
  end if;
end $$;

select cron.schedule('support-notify', '* * * * *', $cmd$
do $body$
declare
  v_url text;
  v_key text;
  v_pending integer;
begin
  select count(*) into v_pending
  from public.support_notification_outbox
  where sent_at is null and next_attempt_at <= now();

  if v_pending = 0 then
    return;
  end if;

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
      where name = 'supabase_url' and decrypted_secret like '%.supabase.co%'
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
    raise notice 'Skipping support-notify: missing supabase URL or service_role_key';
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/support-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end
$body$;
$cmd$);

-- 7. Retention ----------------------------------------------------------------
-- Sent rows are kept for 30 days so a missing notification can still be traced.

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'prune-support-notifications';
  if v_jobid is not null then
    begin
      perform cron.unschedule(v_jobid);
    exception when others then null;
    end;
  end if;
end $$;

select cron.schedule(
  'prune-support-notifications',
  '29 4 * * *',
  $$delete from public.support_notification_outbox where sent_at is not null and sent_at < now() - interval '30 days';$$
);

-- 8. Migration bookkeeping ----------------------------------------------------

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261116150000', '20261116150000_support_notifications.sql', 'opencode')
on conflict (version) do nothing;
