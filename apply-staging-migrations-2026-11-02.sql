-- ============================================================================
-- Unicopier migration-line schema -> TScopier STAGING (axdcledcyhyvzrnfkwat)
-- Generated: 2026-11-02 by opencode. 52 missing migrations (checker output).
-- Source: local working tree of branch `staging-merge` (migration merged in).
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor (staging project) -> paste all ->
-- Run. If it fails partway, the script is resumable: re-run the checker
--   python3 scripts/check-migrations.py --project staging
-- and remove the already-applied sections, or simply re-run this file
-- (every registration is ON CONFLICT DO NOTHING; applied DDL sections that
--  are idempotent will no-op, non-idempotent ones will error - prefer
--  checking the checker output and running only the missing tail).
--
-- BEFORE RUNNING: take a backup (Dashboard -> Database -> Backups).
-- AFTER RUNNING: the checker must print "no MISSING".
-- ============================================================================


-- ========== 20260730130000_layering_modes_foundation.sql ==========
-- Phase A foundation for legacy/static/dynamic range-layering modes.
-- Additive only: existing range_pending_legs rows keep null plan fields and
-- continue to resolve as legacy behavior.

alter table public.range_pending_legs
  add column if not exists layer_plan_id text,
  add column if not exists layer_plan_metadata jsonb;

comment on column public.range_pending_legs.layer_plan_id is
  'Immutable range-layer plan identifier for future static/dynamic execution. Null legacy rows preserve existing behavior.';

comment on column public.range_pending_legs.layer_plan_metadata is
  'JSON snapshot for future layer plans: mode, original range, anchor, configured counts/step, planned layer count/lot, and lock timestamps. Null means legacy.';

create index if not exists range_pending_legs_layer_plan_id_idx
  on public.range_pending_legs(layer_plan_id)
  where layer_plan_id is not null;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20260730130000', '20260730130000_layering_modes_foundation', ARRAY['-- 20260730130000_layering_modes_foundation']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20260730140000_signal_channels_last_live_trigger.sql ==========
/*
  Automatically update signal_channels.last_live_at when any signal is created.

  The canonical pipeline (channel_signals → signal_channels.last_live_at) only
  runs on the elected reader. The Python listener and legacy TS listener paths
  write directly to the per-user signals table without touching signal_channels.

  This trigger catches ALL signal creations regardless of source and bumps
  the corresponding signal_channel's last_live_at via the telegram_channels
  bridge (signals → telegram_channels → signal_channels).
*/

CREATE OR REPLACE FUNCTION public.bump_signal_channel_last_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.signal_channels sc
  SET
    last_live_at = GREATEST(sc.last_live_at, NEW.created_at),
    updated_at = now()
  FROM public.telegram_channels tc
  WHERE tc.id = NEW.channel_id
    AND tc.signal_channel_id IS NOT NULL
    AND tc.signal_channel_id = sc.id
    AND (sc.last_live_at IS NULL OR NEW.created_at > sc.last_live_at);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bump_signal_channel_last_live() IS
  'Updates signal_channels.last_live_at whenever a new signal is inserted, bridging via telegram_channels.';

DROP TRIGGER IF EXISTS trg_bump_signal_channel_last_live ON public.signals;

CREATE TRIGGER trg_bump_signal_channel_last_live
  AFTER INSERT ON public.signals
  FOR EACH ROW
  WHEN (NEW.channel_id IS NOT NULL)
  EXECUTE FUNCTION public.bump_signal_channel_last_live();

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20260730140000', '20260730140000_signal_channels_last_live_trigger', ARRAY['-- 20260730140000_signal_channels_last_live_trigger']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20260806130000_user_profiles_notification_email.sql ==========
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS notification_email_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_profiles.notification_email_enabled IS
  'When true, send an email when a signal is escalated for human review (within the 2-minute approval window).';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20260806130000', '20260806130000_user_profiles_notification_email', ARRAY['-- 20260806130000_user_profiles_notification_email']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261005120000_listener_events_retention.sql ==========
-- listener_events retention + prune (2026-10-05 database-size incident).
--
-- Problem: listener_events had grown to 4.42 GB (84%) of an 8 GB disk with ~12M rows
-- and no retention policy. Six verbose diagnostic event types account for ~95% of rows
-- (signal_reconcile_checked alone: 8.0M rows since 2026-06-12).
--
-- Policy (age since created_at, by event_type):
--   7 days  — high-churn diagnostics (reconcile checks, poll/peer errors, ai skips)
--   30 days — investigation detail (mismatches, parse fallbacks, revisions, review rows)
--             also the DEFAULT for any event_type not listed below
--   90 days — rare incident/ops events (channel auto-disable, telegram link, assistant)
--
-- Prune runs batched (LIMIT'd CTE delete) so a single statement never holds a long
-- lock; scheduled hourly via pg_cron well above steady-state write rate (~100k rows/day).

CREATE OR REPLACE FUNCTION public.listener_events_retention_cutoff(p_event_type text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT now() - CASE
    WHEN p_event_type IN (
      'signal_reconcile_checked',
      'poll_peer_resolve_failed',
      'poll_error',
      'peer_resolve_failed',
      'signal_reconcile_parsed_drift',
      'ai_modification_skipped'
    ) THEN interval '7 days'
    WHEN p_event_type IN (
      'channel_invalid_detected',
      'channel_auto_disabled',
      'channel_reactivated',
      'telegram_link_attempt',
      'telegram_link_success',
      'telegram_link_failed',
      'telegram_link_disconnect',
      'assistant_tool_call'
    ) THEN interval '90 days'
    ELSE interval '30 days'
  END
$$;

COMMENT ON FUNCTION public.listener_events_retention_cutoff(text) IS
  'Retention policy for listener_events: 7 days for verbose diagnostics, 90 days for rare incident/ops events, 30 days (default) for everything else. Returns the timestamp before which rows of p_event_type are expired.';

CREATE OR REPLACE FUNCTION public.prune_listener_events(
  p_batch_rows integer DEFAULT 100000,
  p_max_batches integer DEFAULT 10
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
  v_batch integer;
  v_batches integer := 0;
BEGIN
  IF p_batch_rows < 1000 THEN
    p_batch_rows := 100000;
  END IF;
  IF p_max_batches < 1 THEN
    p_max_batches := 10;
  END IF;

  LOOP
    WITH doomed AS MATERIALIZED (
      SELECT id
      FROM public.listener_events
      WHERE created_at < public.listener_events_retention_cutoff(event_type)
      LIMIT p_batch_rows
    )
    DELETE FROM public.listener_events le
    USING doomed d
    WHERE le.id = d.id;

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    v_batches := v_batches + 1;
    EXIT WHEN v_batch < p_batch_rows OR v_batches >= p_max_batches;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_listener_events(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_listener_events(integer, integer) TO service_role;

COMMENT ON FUNCTION public.prune_listener_events(integer, integer) IS
  'Batched retention delete for listener_events: removes rows past their listener_events_retention_cutoff, p_batch_rows per statement, up to p_max_batches statements. Returns rows deleted. Safe to call repeatedly; scheduled hourly via pg_cron.';

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ DECLARE v_jobid bigint; BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prune-listener-events';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule('prune-listener-events', '41 * * * *', $cmd$
  SELECT public.prune_listener_events(100000, 20)
$cmd$);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261005120000', '20261005120000_listener_events_retention', ARRAY['-- 20261005120000_listener_events_retention']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261006180000_broker_copy_links.sql ==========
-- Broker accounts can be placed on the configuration map as copy sources.
-- Links record which destination should later copy that source. The worker does not read these yet.

alter table public.broker_accounts
  add column if not exists copy_source boolean not null default false;

comment on column public.broker_accounts.copy_source is
  'When true, this account is a copy source and is shown only on the left of the configuration map.';

grant select (copy_source) on public.broker_accounts to authenticated;
grant update (copy_source) on public.broker_accounts to authenticated;

create table if not exists public.broker_copy_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_broker_account_id uuid not null references public.broker_accounts(id) on delete cascade,
  destination_broker_account_id uuid not null references public.broker_accounts(id) on delete cascade,
  manual_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_copy_links_distinct
    check (source_broker_account_id <> destination_broker_account_id),
  constraint broker_copy_links_pair_unique
    unique (source_broker_account_id, destination_broker_account_id)
);

create index if not exists broker_copy_links_user_idx
  on public.broker_copy_links (user_id);

create index if not exists broker_copy_links_destination_idx
  on public.broker_copy_links (destination_broker_account_id);

comment on table public.broker_copy_links is
  'Saved configuration-map link from a source broker to a destination broker. Not executed by the worker yet.';

grant select, insert, update, delete on public.broker_copy_links to authenticated;
grant select, insert, update, delete on public.broker_copy_links to service_role;

alter table public.broker_copy_links enable row level security;

drop policy if exists "Users can view own broker copy links" on public.broker_copy_links;
create policy "Users can view own broker copy links"
  on public.broker_copy_links for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own broker copy links" on public.broker_copy_links;
create policy "Users can insert own broker copy links"
  on public.broker_copy_links for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.broker_accounts src
      where src.id = source_broker_account_id and src.user_id = auth.uid()
    )
    and exists (
      select 1 from public.broker_accounts dst
      where dst.id = destination_broker_account_id and dst.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own broker copy links" on public.broker_copy_links;
create policy "Users can update own broker copy links"
  on public.broker_copy_links for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.broker_accounts src
      where src.id = source_broker_account_id and src.user_id = auth.uid()
    )
    and exists (
      select 1 from public.broker_accounts dst
      where dst.id = destination_broker_account_id and dst.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete own broker copy links" on public.broker_copy_links;
create policy "Users can delete own broker copy links"
  on public.broker_copy_links for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_broker_copy_links_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists broker_copy_links_updated_at on public.broker_copy_links;
create trigger broker_copy_links_updated_at
  before update on public.broker_copy_links
  for each row
  execute function public.set_broker_copy_links_updated_at();

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261006180000', '20261006180000_broker_copy_links', ARRAY['-- 20261006180000_broker_copy_links']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261009223000_tradingview_webhooks.sql ==========
-- TradingView alert webhooks. Each webhook owns a telegram_channels row so the
-- existing broker copy filter (signal_channel_ids / broker_channel_trading_configs)
-- can target it. source_kind keeps the Telegram listener off these rows.

alter table public.telegram_channels
  add column if not exists source_kind text not null default 'telegram';

alter table public.telegram_channels
  drop constraint if exists telegram_channels_source_kind_check;

alter table public.telegram_channels
  add constraint telegram_channels_source_kind_check
  check (source_kind in ('telegram', 'tradingview'));

comment on column public.telegram_channels.source_kind is
  'telegram = listener channel. tradingview = webhook copy target, not a Telegram chat.';

create table if not exists public.tradingview_webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null unique references public.telegram_channels(id) on delete cascade,
  name text not null default 'TradingView',
  token_hash text not null unique,
  token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tradingview_webhooks is
  'Per-user TradingView alert webhook. Ingest looks up token_hash. token is owner-readable so the URL can be copied.';

comment on column public.tradingview_webhooks.token_hash is
  'SHA-256 hex of the URL secret. The ingest function must not log the raw token.';

create index if not exists tradingview_webhooks_user_idx
  on public.tradingview_webhooks (user_id, created_at desc);

create table if not exists public.tradingview_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.tradingview_webhooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  status text not null,
  skip_reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint tradingview_webhook_deliveries_status_check
    check (status in ('accepted', 'skipped', 'error', 'duplicate')),
  constraint tradingview_webhook_deliveries_idempotency_unique
    unique (webhook_id, idempotency_key)
);

create index if not exists tradingview_webhook_deliveries_recent_idx
  on public.tradingview_webhook_deliveries (webhook_id, created_at desc);

alter table public.tradingview_webhooks enable row level security;
alter table public.tradingview_webhook_deliveries enable row level security;

drop policy if exists "Users can view own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can view own tradingview webhooks"
  on public.tradingview_webhooks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view own tradingview webhook deliveries"
  on public.tradingview_webhook_deliveries;
create policy "Users can view own tradingview webhook deliveries"
  on public.tradingview_webhook_deliveries for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.tradingview_webhooks to authenticated;
grant select on public.tradingview_webhook_deliveries to authenticated;

drop policy if exists "Users can insert own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can insert own tradingview webhooks"
  on public.tradingview_webhooks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can update own tradingview webhooks"
  on public.tradingview_webhooks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can delete own tradingview webhooks"
  on public.tradingview_webhooks for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own tradingview channels"
  on public.telegram_channels;
create policy "Users can insert own tradingview channels"
  on public.telegram_channels for insert
  to authenticated
  with check (auth.uid() = user_id and source_kind = 'tradingview');

-- TradingView copy targets must not consume the Telegram channel allowance.
create or replace function public.enforce_telegram_channel_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.source_kind = 'tradingview' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.is_active, false) and coalesce(new.is_active, false) then
    return new;
  end if;
  if not coalesce(new.is_active, false) then
    return new;
  end if;
  if public.user_is_admin_for_plan_limits(new.user_id) then
    return new;
  end if;

  v_limit := public.user_telegram_channel_limit(new.user_id);
  if v_limit is null then
    return new;
  end if;
  if v_limit <= 0 then
    raise exception 'subscription_required: An active subscription is required to add Telegram channels.'
      using errcode = 'check_violation';
  end if;

  select count(*)::integer into v_count
  from public.telegram_channels tc
  where tc.user_id = new.user_id
    and tc.is_active = true
    and coalesce(tc.source_kind, 'telegram') <> 'tradingview'
    and (tg_op = 'INSERT' or tc.id <> new.id);

  if v_count >= v_limit then
    raise exception 'channel_limit: Basic plan includes % Telegram channels. Upgrade to Advanced for unlimited channels.', v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261009223000', '20261009223000_tradingview_webhooks', ARRAY['-- 20261009223000_tradingview_webhooks']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261009233000_tradingview_webhook_client_writes.sql ==========
-- Let the signed-in user create and manage TradingView webhooks from the app.
-- Alert ingest still goes through the tradingview-webhook Edge Function.

grant select, insert, update, delete on public.tradingview_webhooks to authenticated;
grant select on public.tradingview_webhook_deliveries to authenticated;

drop policy if exists "Users can insert own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can insert own tradingview webhooks"
  on public.tradingview_webhooks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can update own tradingview webhooks"
  on public.tradingview_webhooks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own tradingview webhooks"
  on public.tradingview_webhooks;
create policy "Users can delete own tradingview webhooks"
  on public.tradingview_webhooks for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own tradingview channels"
  on public.telegram_channels;
create policy "Users can insert own tradingview channels"
  on public.telegram_channels for insert
  to authenticated
  with check (auth.uid() = user_id and source_kind = 'tradingview');

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261009233000', '20261009233000_tradingview_webhook_client_writes', ARRAY['-- 20261009233000_tradingview_webhook_client_writes']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261010120000_discord_signal_source.sql ==========
-- Discord signal sources share telegram_channels so broker links stay on the existing foreign keys.
-- A shadow row uses source_kind = 'discord' and channel_id = dc:<guild_id>:<channel_id>.
-- Discord rows count toward the plan channel allowance. TradingView stays excluded.

alter table public.telegram_channels
  drop constraint if exists telegram_channels_source_kind_check;

alter table public.telegram_channels
  add constraint telegram_channels_source_kind_check
  check (source_kind in ('telegram', 'tradingview', 'discord'));

create table if not exists public.discord_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  guild_id text not null,
  guild_name text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, guild_id)
);

create table if not exists public.discord_guild_channels (
  guild_id text not null,
  discord_channel_id text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_channel_id)
);

create table if not exists public.discord_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id uuid not null references public.discord_installations (id) on delete cascade,
  guild_id text not null,
  discord_channel_id text not null,
  name text not null,
  channel_id uuid not null references public.telegram_channels (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, discord_channel_id)
);

create index if not exists discord_channels_guild_channel_idx
  on public.discord_channels (guild_id, discord_channel_id);

alter table public.discord_installations enable row level security;
alter table public.discord_guild_channels enable row level security;
alter table public.discord_channels enable row level security;

drop policy if exists "Users can select own discord installations" on public.discord_installations;
create policy "Users can select own discord installations"
  on public.discord_installations for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own discord installations" on public.discord_installations;
create policy "Users can insert own discord installations"
  on public.discord_installations for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own discord installations" on public.discord_installations;
create policy "Users can update own discord installations"
  on public.discord_installations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own discord installations" on public.discord_installations;
create policy "Users can delete own discord installations"
  on public.discord_installations for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select installed discord guild channels" on public.discord_guild_channels;
create policy "Users can select installed discord guild channels"
  on public.discord_guild_channels for select
  to authenticated
  using (
    exists (
      select 1
      from public.discord_installations di
      where di.user_id = auth.uid()
        and di.guild_id = discord_guild_channels.guild_id
    )
  );

drop policy if exists "Users can select own discord channels" on public.discord_channels;
create policy "Users can select own discord channels"
  on public.discord_channels for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own discord channels" on public.discord_channels;
create policy "Users can insert own discord channels"
  on public.discord_channels for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.discord_installations di
      where di.id = installation_id
        and di.user_id = auth.uid()
        and di.guild_id = guild_id
    )
  );

drop policy if exists "Users can update own discord channels" on public.discord_channels;
create policy "Users can update own discord channels"
  on public.discord_channels for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own discord channels" on public.discord_channels;
create policy "Users can delete own discord channels"
  on public.discord_channels for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own discord channels shadow" on public.telegram_channels;
create policy "Users can insert own discord channels shadow"
  on public.telegram_channels for insert
  to authenticated
  with check (auth.uid() = user_id and source_kind = 'discord');

grant select, insert, update, delete on public.discord_installations to authenticated;
grant select on public.discord_guild_channels to authenticated;
grant select, insert, update, delete on public.discord_channels to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261010120000', '20261010120000_discord_signal_source', ARRAY['-- 20261010120000_discord_signal_source']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261010140000_whatsapp_signal_source.sql ==========
-- WhatsApp signal sources share telegram_channels so broker links stay on the existing foreign keys.
-- A shadow row uses source_kind = 'whatsapp' and channel_id = wa:<groupJid>.
-- WhatsApp groups count toward the plan channel allowance. TradingView stays excluded.

alter table public.telegram_channels
  drop constraint if exists telegram_channels_source_kind_check;

alter table public.telegram_channels
  add constraint telegram_channels_source_kind_check
  check (source_kind in ('telegram', 'tradingview', 'discord', 'whatsapp'));

create table if not exists public.whatsapp_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null default '',
  display_name text not null default '',
  status text not null default 'disconnected',
  updated_at timestamptz not null default now(),
  constraint whatsapp_sessions_status_check check (status in ('qr', 'connected', 'disconnected'))
);

create table if not exists public.whatsapp_auth (
  user_id uuid primary key references auth.users (id) on delete cascade,
  creds jsonb not null,
  keys jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_jid text not null,
  name text not null,
  channel_id uuid not null references public.telegram_channels (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, group_jid)
);

create index if not exists whatsapp_groups_jid_idx
  on public.whatsapp_groups (group_jid);

alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_auth enable row level security;
alter table public.whatsapp_groups enable row level security;

drop policy if exists "Users can select own whatsapp session" on public.whatsapp_sessions;
create policy "Users can select own whatsapp session"
  on public.whatsapp_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select own whatsapp groups" on public.whatsapp_groups;
create policy "Users can select own whatsapp groups"
  on public.whatsapp_groups for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own whatsapp groups" on public.whatsapp_groups;
create policy "Users can insert own whatsapp groups"
  on public.whatsapp_groups for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own whatsapp groups" on public.whatsapp_groups;
create policy "Users can update own whatsapp groups"
  on public.whatsapp_groups for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own whatsapp groups" on public.whatsapp_groups;
create policy "Users can delete own whatsapp groups"
  on public.whatsapp_groups for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own whatsapp channels shadow" on public.telegram_channels;
create policy "Users can insert own whatsapp channels shadow"
  on public.telegram_channels for insert
  to authenticated
  with check (auth.uid() = user_id and source_kind = 'whatsapp');

grant select on public.whatsapp_sessions to authenticated;
grant select, insert, update, delete on public.whatsapp_groups to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261010140000', '20261010140000_whatsapp_signal_source', ARRAY['-- 20261010140000_whatsapp_signal_source']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261010160000_profile_photos.sql ==========
-- Profile photos: store the public URL on the profile and the file in Storage.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Profile photos public read" ON storage.objects;
CREATE POLICY "Profile photos public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "Users upload own profile photo" ON storage.objects;
CREATE POLICY "Users upload own profile photo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own profile photo" ON storage.objects;
CREATE POLICY "Users update own profile photo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own profile photo" ON storage.objects;
CREATE POLICY "Users delete own profile photo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261010160000', '20261010160000_profile_photos', ARRAY['-- 20261010160000_profile_photos']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261010180000_user_wallets.sql ==========
/*
  # Copy-subscription wallets

  One balance row per user, plus a ledger of copy payments.
  Stripe charging and payouts write these rows later.
  Users can read their own wallet and any ledger row where they paid or were paid.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_ledger_status') THEN
    CREATE TYPE wallet_ledger_status AS ENUM ('pending', 'paid', 'reversed');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_cents bigint NOT NULL DEFAULT 0,
  pending_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_wallets_available_cents_nonnegative CHECK (available_cents >= 0),
  CONSTRAINT user_wallets_pending_cents_nonnegative CHECK (pending_cents >= 0)
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status wallet_ledger_status NOT NULL DEFAULT 'pending',
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_amount_cents_positive CHECK (amount_cents > 0),
  CONSTRAINT wallet_ledger_not_self CHECK (payer_user_id <> provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_payer_user_id
  ON public.wallet_ledger (payer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_provider_user_id
  ON public.wallet_ledger (provider_user_id, created_at DESC);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wallet" ON public.user_wallets;
CREATE POLICY "Users can view own wallet"
  ON public.user_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own wallet ledger" ON public.wallet_ledger;
CREATE POLICY "Users can view own wallet ledger"
  ON public.wallet_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = payer_user_id OR auth.uid() = provider_user_id);

CREATE OR REPLACE FUNCTION public.touch_user_wallet_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_wallets_touch_updated_at ON public.user_wallets;
CREATE TRIGGER user_wallets_touch_updated_at
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_wallet_updated_at();

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261010180000', '20261010180000_user_wallets', ARRAY['-- 20261010180000_user_wallets']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261012130000_social_follow.sql ==========
-- Production-backed Social Follow foundation.
--
-- Authenticated user ids are the only social identities. public.user_profiles
-- remains private; the directory RPC below exposes only the named safe fields.

create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_mode text not null default 'open'
    check (access_mode in ('open', 'private')),
  is_listed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.social_profiles is
  'Explicit opt-in to the social directory. Public identity remains sourced from the private user_profiles row through narrow RPCs.';

create table if not exists public.social_follow_relationships (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  followed_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint social_follow_relationships_not_self
    check (follower_user_id <> followed_user_id),
  constraint social_follow_relationships_pair_unique
    unique (follower_user_id, followed_user_id)
);

comment on table public.social_follow_relationships is
  'One canonical outgoing relationship per user pair. Private profiles begin pending; open profiles are accepted immediately.';

create index if not exists social_follow_relationships_followed_status_idx
  on public.social_follow_relationships (followed_user_id, status);

create index if not exists social_follow_relationships_follower_status_idx
  on public.social_follow_relationships (follower_user_id, status);

create or replace function public.set_social_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists social_profiles_updated_at on public.social_profiles;
create trigger social_profiles_updated_at
  before update on public.social_profiles
  for each row execute function public.set_social_updated_at();

drop trigger if exists social_follow_relationships_updated_at on public.social_follow_relationships;
create trigger social_follow_relationships_updated_at
  before update on public.social_follow_relationships
  for each row execute function public.set_social_updated_at();

alter table public.social_profiles enable row level security;
alter table public.social_follow_relationships enable row level security;

drop policy if exists "Users can view own social profile registration" on public.social_profiles;
create policy "Users can view own social profile registration"
  on public.social_profiles for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Participants can view their social relationships" on public.social_follow_relationships;
create policy "Participants can view their social relationships"
  on public.social_follow_relationships for select
  to authenticated
  using (auth.uid() = follower_user_id or auth.uid() = followed_user_id);

-- Direct browser writes are intentionally unavailable. All actor-sensitive
-- mutations below derive the actor from auth.uid().
revoke all on table public.social_profiles from anon, authenticated;
revoke all on table public.social_follow_relationships from anon, authenticated;
grant select on table public.social_profiles to authenticated;
grant select on table public.social_follow_relationships to authenticated;
grant all on table public.social_profiles to service_role;
grant all on table public.social_follow_relationships to service_role;

create or replace function public.social_follow_actor_is_verified(p_actor uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from auth.users au
    join public.user_profiles up on up.user_id = au.id
    where au.id = p_actor
      and case
        when public.auth_user_is_oauth(au)
          or (coalesce(au.raw_app_meta_data->>'provider', '') <> '' and au.raw_app_meta_data->>'provider' <> 'email')
        then au.email_confirmed_at is not null
        else up.email_verified_at is not null
      end
  );
$$;

create or replace function public.social_follow_profile_is_eligible(p_actor uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.social_profiles sp
    join public.user_profiles up on up.user_id = sp.user_id
    where sp.user_id = p_actor
      and sp.is_listed = true
      and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  );
$$;

create or replace function public.guard_listed_social_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(nullif(btrim(new.display_name), ''), nullif(btrim(new.username), '')) is null
    and exists (
      select 1
      from public.social_profiles sp
      where sp.user_id = new.user_id
        and sp.is_listed = true
    )
  then
    raise exception 'A listed social profile requires a display name or username'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_social_identity_guard on public.user_profiles;
create trigger user_profiles_social_identity_guard
  before update of display_name, username on public.user_profiles
  for each row execute function public.guard_listed_social_profile_identity();

create or replace function public.register_social_profile()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_has_public_identity boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social Follow requires a verified account' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
    into v_has_public_identity
  from public.user_profiles up
  where up.user_id = v_actor;

  if not coalesce(v_has_public_identity, false) then
    raise exception 'Complete your display name or username before joining the social directory'
      using errcode = 'check_violation';
  end if;

  insert into public.social_profiles (user_id)
  values (v_actor)
  on conflict (user_id) do update
    set is_listed = true;
end;
$$;

create or replace function public.set_social_profile_access(p_access_mode text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social Follow requires a verified account' using errcode = '42501';
  end if;
  if p_access_mode not in ('open', 'private') then
    raise exception 'Invalid social profile access mode' using errcode = '22023';
  end if;

  update public.social_profiles
  set access_mode = p_access_mode
  where user_id = v_actor;

  if not found then
    raise exception 'Social profile is not registered' using errcode = 'P0002';
  end if;

  -- Once an owner becomes open, outstanding requests no longer require manual
  -- approval. Existing accepted followers remain accepted when becoming private.
  if p_access_mode = 'open' then
    update public.social_follow_relationships
    set status = 'accepted', responded_at = now()
    where followed_user_id = v_actor
      and status = 'pending';
  end if;
end;
$$;

create or replace function public.follow_social_profile(p_profile_user_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_access_mode text;
  v_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social Follow requires a verified account' using errcode = '42501';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Following requires a registered, listed social profile with a public identity'
      using errcode = '55000';
  end if;
  if p_profile_user_id is null then
    raise exception 'Profile user id is required' using errcode = '22004';
  end if;
  if p_profile_user_id = v_actor then
    raise exception 'Users cannot follow themselves' using errcode = 'check_violation';
  end if;

  select sp.access_mode into v_access_mode
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  where sp.user_id = p_profile_user_id
    and sp.is_listed = true
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  for update of sp;

  if v_access_mode is null then
    raise exception 'Social profile is not available' using errcode = 'P0002';
  end if;

  v_status := case when v_access_mode = 'open' then 'accepted' else 'pending' end;

  insert into public.social_follow_relationships (
    follower_user_id,
    followed_user_id,
    status,
    responded_at
  ) values (
    v_actor,
    p_profile_user_id,
    v_status,
    case when v_status = 'accepted' then now() else null end
  )
  on conflict (follower_user_id, followed_user_id) do update
  set status = case
        when public.social_follow_relationships.status = 'accepted' then 'accepted'
        else excluded.status
      end,
      responded_at = case
        when public.social_follow_relationships.status = 'accepted' then public.social_follow_relationships.responded_at
        when excluded.status = 'accepted' then now()
        else null
      end;

  select sfr.status into v_status
  from public.social_follow_relationships sfr
  where sfr.follower_user_id = v_actor
    and sfr.followed_user_id = p_profile_user_id;

  return v_status;
end;
$$;

create or replace function public.remove_social_follow(p_profile_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social Follow requires a verified account' using errcode = '42501';
  end if;

  delete from public.social_follow_relationships
  where follower_user_id = v_actor
    and followed_user_id = p_profile_user_id;
end;
$$;

create or replace function public.resolve_social_follow_request(
  p_follower_user_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social Follow requires a verified account' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'declined') then
    raise exception 'Invalid follow request decision' using errcode = '22023';
  end if;

  update public.social_follow_relationships
  set status = p_decision,
      responded_at = now()
  where follower_user_id = p_follower_user_id
    and followed_user_id = v_actor
    and status = 'pending';

  if not found then
    raise exception 'Pending follow request was not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_social_directory()
returns table (
  profile_user_id uuid,
  display_name text,
  username text,
  country text,
  access_mode text,
  is_self boolean,
  follower_count bigint,
  following_count bigint,
  viewer_relationship_status text,
  follows_viewer_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
  select
    sp.user_id,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) as display_name,
    coalesce(nullif(btrim(up.username), ''), '') as username,
    coalesce(nullif(btrim(up.country), ''), '') as country,
    sp.access_mode,
    sp.user_id = v_actor as is_self,
    (
      select count(*)
      from public.social_follow_relationships incoming
      join public.social_profiles incoming_profile on incoming_profile.user_id = incoming.follower_user_id
      join public.user_profiles incoming_identity on incoming_identity.user_id = incoming.follower_user_id
      where incoming.followed_user_id = sp.user_id
        and incoming.status = 'accepted'
        and incoming_profile.is_listed = true
        and coalesce(nullif(btrim(incoming_identity.display_name), ''), nullif(btrim(incoming_identity.username), '')) is not null
    ) as follower_count,
    (
      select count(*)
      from public.social_follow_relationships outgoing_count
      join public.social_profiles followed_profile on followed_profile.user_id = outgoing_count.followed_user_id
      join public.user_profiles followed_identity on followed_identity.user_id = outgoing_count.followed_user_id
      where outgoing_count.follower_user_id = sp.user_id
        and outgoing_count.status = 'accepted'
        and followed_profile.is_listed = true
        and coalesce(nullif(btrim(followed_identity.display_name), ''), nullif(btrim(followed_identity.username), '')) is not null
    ) as following_count,
    outgoing.status as viewer_relationship_status,
    incoming_viewer.status as follows_viewer_status
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join public.social_follow_relationships outgoing
    on outgoing.follower_user_id = v_actor
   and outgoing.followed_user_id = sp.user_id
  left join public.social_follow_relationships incoming_viewer
    on incoming_viewer.follower_user_id = sp.user_id
   and incoming_viewer.followed_user_id = v_actor
  where sp.is_listed = true
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  order by 7 desc, 2 asc, 1 asc;
end;
$$;

revoke all on function public.set_social_updated_at() from public, anon, authenticated;
revoke all on function public.social_follow_actor_is_verified(uuid) from public, anon, authenticated;
revoke all on function public.social_follow_profile_is_eligible(uuid) from public, anon, authenticated;
revoke all on function public.guard_listed_social_profile_identity() from public, anon, authenticated;
revoke all on function public.register_social_profile() from public, anon;
revoke all on function public.set_social_profile_access(text) from public, anon;
revoke all on function public.follow_social_profile(uuid) from public, anon;
revoke all on function public.remove_social_follow(uuid) from public, anon;
revoke all on function public.resolve_social_follow_request(uuid, text) from public, anon;
revoke all on function public.get_social_directory() from public, anon;

grant execute on function public.register_social_profile() to authenticated;
grant execute on function public.set_social_profile_access(text) to authenticated;
grant execute on function public.follow_social_profile(uuid) to authenticated;
grant execute on function public.remove_social_follow(uuid) to authenticated;
grant execute on function public.resolve_social_follow_request(uuid, text) to authenticated;
grant execute on function public.get_social_directory() to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261012130000', '20261012130000_social_follow', ARRAY['-- 20261012130000_social_follow']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261012220000_ctrader_broker_accounts.sql ==========
-- cTrader Open API accounts. Tokens stay service-role only.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, or ctrader. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists ctrader_account_id text,
  add column if not exists ctrader_environment text,
  add column if not exists ctrader_access_token_encrypted text,
  add column if not exists ctrader_refresh_token_encrypted text,
  add column if not exists ctrader_token_expires_at timestamptz,
  add column if not exists ctrader_status text;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_ctrader_environment_check;

alter table public.broker_accounts
  add constraint broker_accounts_ctrader_environment_check
    check (ctrader_environment is null or ctrader_environment in ('demo', 'live'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_ctrader_status_check;

alter table public.broker_accounts
  add constraint broker_accounts_ctrader_status_check
    check (ctrader_status is null or ctrader_status in ('connecting', 'connected', 'error', 'disconnected'));

comment on column public.broker_accounts.ctrader_account_id is
  'cTrader ctidTraderAccountId. Safe to show in the broker list.';
comment on column public.broker_accounts.ctrader_environment is
  'cTrader Open API host: demo or live.';
comment on column public.broker_accounts.ctrader_access_token_encrypted is
  'AES-256-GCM cTrader access token. Service-role only.';
comment on column public.broker_accounts.ctrader_refresh_token_encrypted is
  'AES-256-GCM cTrader refresh token. Service-role only.';
comment on column public.broker_accounts.ctrader_token_expires_at is
  'Access-token expiry. Service-role only.';
comment on column public.broker_accounts.ctrader_status is
  'cTrader link status shown in the Connection column.';

create unique index if not exists broker_accounts_ctrader_account_id_idx
  on public.broker_accounts (user_id, ctrader_account_id)
  where ctrader_account_id is not null and btrim(ctrader_account_id) <> '';

grant select (ctrader_account_id, ctrader_environment, ctrader_status)
  on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
  end if;
  return new;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261012220000', '20261012220000_ctrader_broker_accounts', ARRAY['-- 20261012220000_ctrader_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261012231000_ctrader_write_lease.sql ==========
-- Let the copy worker take a write lease for cTrader accounts.
-- The lease previously rejected every provider other than fxsocket and mtapi,
-- so a linked cTrader account could not receive orderSend.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261012231000', '20261012231000_ctrader_write_lease', ARRAY['-- 20261012231000_ctrader_write_lease']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261012234000_ctrader_app_credentials.sql ==========
-- Open API app id and secret travel with the linked account so the trade
-- worker can authenticate without a second copy of the edge-function secrets.

alter table public.broker_accounts
  add column if not exists ctrader_client_id_encrypted text,
  add column if not exists ctrader_client_secret_encrypted text;

comment on column public.broker_accounts.ctrader_client_id_encrypted is
  'AES-256-GCM cTrader Open API client id. Service-role only.';
comment on column public.broker_accounts.ctrader_client_secret_encrypted is
  'AES-256-GCM cTrader Open API client secret. Service-role only.';

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
  end if;
  return new;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261012234000', '20261012234000_ctrader_app_credentials', ARRAY['-- 20261012234000_ctrader_app_credentials']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261014120000_social_copy_trading.sql ==========
-- Persistent, cross-user social copy trading.
-- Deliberately separate from broker_copy_links: those rows are same-owner
-- configuration-map links and are not an authorization boundary for social copying.

create table public.social_copy_sources (
  id uuid primary key default gen_random_uuid(),
  trader_user_id uuid not null references auth.users(id) on delete cascade,
  broker_account_id uuid not null references public.broker_accounts(id) on delete restrict,
  status text not null default 'published' check (status in ('published', 'paused', 'retired')),
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker_account_id)
);

comment on table public.social_copy_sources is
  'Explicit trader opt-in publishing a broker account as a social-copy source. Contains no credentials.';

create table public.social_copy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.social_copy_sources(id) on delete restrict,
  source_trader_user_id uuid not null references auth.users(id) on delete restrict,
  subscriber_user_id uuid not null references auth.users(id) on delete cascade,
  destination_broker_account_id uuid not null references public.broker_accounts(id) on delete restrict,
  sizing_mode text not null check (sizing_mode in ('fixed_lot', 'lot_multiplier', 'equity_ratio')),
  fixed_lot numeric,
  lot_multiplier numeric not null default 1,
  max_lot numeric not null,
  max_daily_loss numeric,
  requested_account_mode text not null default 'demo' check (requested_account_mode in ('demo', 'live')),
  symbol_map jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'active', 'paused', 'stopped', 'error', 'emergency_stopped')
  ),
  desired_status text not null default 'active' check (desired_status in ('active', 'paused', 'stopped')),
  error_code text,
  error_detail text,
  worker_acknowledged_at timestamptz,
  last_reconciled_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stopped_at timestamptz,
  constraint social_copy_subscription_not_self check (source_trader_user_id <> subscriber_user_id),
  constraint social_copy_fixed_lot_valid check (
    (sizing_mode = 'fixed_lot' and fixed_lot is not null and fixed_lot > 0)
    or (sizing_mode <> 'fixed_lot' and fixed_lot is null)
  ),
  constraint social_copy_multiplier_valid check (lot_multiplier > 0 and lot_multiplier <= 100),
  constraint social_copy_max_lot_valid check (max_lot > 0 and max_lot <= 1000),
  constraint social_copy_daily_loss_valid check (max_daily_loss is null or max_daily_loss > 0),
  constraint social_copy_symbol_map_object check (jsonb_typeof(symbol_map) = 'object')
);

create unique index social_copy_subscriptions_current_pair_idx
  on public.social_copy_subscriptions (source_id, destination_broker_account_id)
  where status not in ('stopped', 'emergency_stopped');
create index social_copy_subscriptions_worker_idx
  on public.social_copy_subscriptions (desired_status, status, lease_expires_at);
create index social_copy_subscriptions_subscriber_idx
  on public.social_copy_subscriptions (subscriber_user_id, created_at desc);

create table public.social_copy_trade_mappings (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.social_copy_subscriptions(id) on delete restrict,
  source_ticket text not null,
  destination_ticket text,
  source_symbol text not null,
  destination_symbol text not null,
  source_side text not null check (source_side in ('buy', 'sell')),
  source_volume numeric not null check (source_volume > 0),
  destination_volume numeric not null check (destination_volume > 0),
  source_stop_loss numeric,
  source_take_profit numeric,
  state text not null default 'opening' check (state in ('opening', 'open', 'closing', 'closed', 'error', 'uncertain')),
  broker_comment text not null,
  opened_at timestamptz,
  closed_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, source_ticket),
  unique (subscription_id, broker_comment)
);

create table public.social_copy_execution_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.social_copy_subscriptions(id) on delete restrict,
  mapping_id uuid references public.social_copy_trade_mappings(id) on delete restrict,
  source_ticket text not null,
  action text not null check (action in ('activate', 'open', 'modify', 'close', 'unsupported', 'reconcile')),
  idempotency_key text not null,
  status text not null default 'claimed' check (status in ('claimed', 'succeeded', 'failed', 'uncertain', 'skipped')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (subscription_id, idempotency_key)
);

create index social_copy_trade_mappings_open_idx
  on public.social_copy_trade_mappings (subscription_id, state);
create index social_copy_execution_events_subscription_idx
  on public.social_copy_execution_events (subscription_id, created_at desc);

create or replace function public.set_social_copy_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger social_copy_sources_updated_at before update on public.social_copy_sources
  for each row execute function public.set_social_copy_updated_at();
create trigger social_copy_subscriptions_updated_at before update on public.social_copy_subscriptions
  for each row execute function public.set_social_copy_updated_at();
create trigger social_copy_trade_mappings_updated_at before update on public.social_copy_trade_mappings
  for each row execute function public.set_social_copy_updated_at();
create trigger social_copy_execution_events_updated_at before update on public.social_copy_execution_events
  for each row execute function public.set_social_copy_updated_at();

alter table public.social_copy_sources enable row level security;
alter table public.social_copy_subscriptions enable row level security;
alter table public.social_copy_trade_mappings enable row level security;
alter table public.social_copy_execution_events enable row level security;

revoke all on table public.social_copy_sources from anon, authenticated;
revoke all on table public.social_copy_subscriptions from anon, authenticated;
revoke all on table public.social_copy_trade_mappings from anon, authenticated;
revoke all on table public.social_copy_execution_events from anon, authenticated;
grant select on table public.social_copy_sources to authenticated;
grant select on table public.social_copy_subscriptions to authenticated;
grant select on table public.social_copy_trade_mappings to authenticated;
grant select on table public.social_copy_execution_events to authenticated;
grant all on table public.social_copy_sources to service_role;
grant all on table public.social_copy_subscriptions to service_role;
grant all on table public.social_copy_trade_mappings to service_role;
grant all on table public.social_copy_execution_events to service_role;

create policy "Owners can view social copy sources" on public.social_copy_sources
  for select to authenticated using (trader_user_id = auth.uid());
create policy "Subscribers can view own social copy subscriptions" on public.social_copy_subscriptions
  for select to authenticated using (subscriber_user_id = auth.uid());
create policy "Subscribers can view own social copy mappings" on public.social_copy_trade_mappings
  for select to authenticated using (exists (
    select 1 from public.social_copy_subscriptions s
    where s.id = subscription_id and s.subscriber_user_id = auth.uid()
  ));
create policy "Subscribers can view own social copy events" on public.social_copy_execution_events
  for select to authenticated using (exists (
    select 1 from public.social_copy_subscriptions s
    where s.id = subscription_id and s.subscriber_user_id = auth.uid()
  ));

create or replace function public.publish_social_copy_source(
  p_broker_account_id uuid,
  p_label text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social copy source publishing requires a verified account' using errcode = '42501';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before publishing a copy source' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.broker_accounts b where b.id = p_broker_account_id and b.user_id = v_actor
  ) then raise exception 'Broker account is not owned by the current user' using errcode = '42501'; end if;

  insert into public.social_copy_sources (trader_user_id, broker_account_id, status, label)
  values (v_actor, p_broker_account_id, 'published', nullif(btrim(p_label), ''))
  on conflict (broker_account_id) do update set
    status = 'published', label = excluded.label
  where public.social_copy_sources.trader_user_id = v_actor
  returning id into v_id;
  if v_id is null then raise exception 'Copy source belongs to another trader' using errcode = '42501'; end if;
  return v_id;
end;
$$;

create or replace function public.set_social_copy_source_status(p_source_id uuid, p_status text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_status not in ('published', 'paused', 'retired') then
    raise exception 'Invalid copy source status' using errcode = '22023';
  end if;
  update public.social_copy_sources set status = p_status
  where id = p_source_id and trader_user_id = v_actor;
  if not found then raise exception 'Copy source was not found' using errcode = 'P0002'; end if;
  if p_status <> 'published' then
    update public.social_copy_subscriptions set desired_status = 'paused'
    where source_id = p_source_id and status in ('pending', 'active');
  end if;
end;
$$;

create or replace function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (source_id uuid, trader_user_id uuid, label text, provider text, platform text, account_mode text, connection_healthy boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.trader_user_id, coalesce(s.label, 'Copy source'),
    coalesce(b.provider, 'fxsocket'), b.platform,
    case when lower(coalesce(b.linked_account_type, '')) in ('demo', 'practice') then 'demo' else 'live' end,
    (b.is_active = true and b.connection_status in ('connected', 'healthy'))
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (
      sp.access_mode = 'open'
      or s.trader_user_id = auth.uid()
      or exists (select 1 from public.social_follow_relationships r
        where r.follower_user_id = auth.uid() and r.followed_user_id = s.trader_user_id and r.status = 'accepted')
    );
$$;

create or replace function public.create_social_copy_subscription(
  p_source_id uuid,
  p_destination_broker_account_id uuid,
  p_sizing_mode text,
  p_fixed_lot numeric,
  p_lot_multiplier numeric,
  p_max_lot numeric,
  p_max_daily_loss numeric default null,
  p_requested_account_mode text default 'demo',
  p_symbol_map jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_source public.social_copy_sources%rowtype; v_access text; v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before copying a trader' using errcode = '55000';
  end if;
  select s.* into v_source
  from public.social_copy_sources s join public.social_profiles sp on sp.user_id = s.trader_user_id
  where s.id = p_source_id and s.status = 'published' and sp.is_listed = true;
  if not found then raise exception 'Social copy source is unavailable' using errcode = 'P0002'; end if;
  select sp.access_mode into v_access from public.social_profiles sp where sp.user_id = v_source.trader_user_id;
  if v_source.trader_user_id = v_actor then raise exception 'Users cannot copy themselves' using errcode = '23514'; end if;
  if v_access = 'private' and not exists (
    select 1 from public.social_follow_relationships r
    where r.follower_user_id = v_actor and r.followed_user_id = v_source.trader_user_id and r.status = 'accepted'
  ) then raise exception 'An accepted follow is required for this private trader' using errcode = '42501'; end if;
  if not exists (select 1 from public.broker_accounts b
    where b.id = p_destination_broker_account_id and b.user_id = v_actor) then
    raise exception 'Destination broker account is not owned by the current user' using errcode = '42501';
  end if;
  if p_sizing_mode not in ('fixed_lot', 'lot_multiplier', 'equity_ratio')
    or p_requested_account_mode not in ('demo', 'live') or coalesce(p_lot_multiplier, 0) <= 0
    or coalesce(p_max_lot, 0) <= 0 or (p_sizing_mode = 'fixed_lot' and coalesce(p_fixed_lot, 0) <= 0)
    or jsonb_typeof(coalesce(p_symbol_map, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid social copy risk settings' using errcode = '22023';
  end if;

  insert into public.social_copy_subscriptions (
    source_id, source_trader_user_id, subscriber_user_id, destination_broker_account_id,
    sizing_mode, fixed_lot, lot_multiplier, max_lot, max_daily_loss,
    requested_account_mode, symbol_map
  ) values (
    p_source_id, v_source.trader_user_id, v_actor, p_destination_broker_account_id,
    p_sizing_mode, case when p_sizing_mode = 'fixed_lot' then p_fixed_lot else null end,
    p_lot_multiplier, p_max_lot, p_max_daily_loss, p_requested_account_mode, coalesce(p_symbol_map, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A current subscription already exists for this source and destination' using errcode = '23505';
end;
$$;

create or replace function public.set_social_copy_subscription_status(p_subscription_id uuid, p_action text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_action not in ('pause', 'resume', 'stop', 'emergency_stop') then
    raise exception 'Invalid subscription action' using errcode = '22023';
  end if;
  update public.social_copy_subscriptions set
    desired_status = case when p_action = 'resume' then 'active' when p_action = 'pause' then 'paused' else 'stopped' end,
    status = 'pending',
    error_code = case when p_action = 'emergency_stop' then 'EMERGENCY_STOP_REQUESTED' else null end,
    error_detail = case when p_action = 'emergency_stop' then 'Emergency liquidation is awaiting worker acknowledgement' else null end,
    stopped_at = case when p_action in ('stop', 'emergency_stop') then now() else stopped_at end
  where id = p_subscription_id and subscriber_user_id = v_actor
    and (status not in ('stopped', 'emergency_stopped') or p_action = 'emergency_stop');
  if not found then raise exception 'Current subscription was not found' using errcode = 'P0002'; end if;
end;
$$;
create or replace function public.check_social_copy_subscription_authorization(p_subscription_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when current_user in ('service_role', 'postgres') then exists (
    select 1
    from public.social_copy_subscriptions s
    join public.social_copy_sources src on src.id = s.source_id
    join public.social_profiles sp on sp.user_id = src.trader_user_id
    join public.broker_accounts source_account on source_account.id = src.broker_account_id
    join public.broker_accounts destination_account on destination_account.id = s.destination_broker_account_id
    where s.id = p_subscription_id
      and src.status = 'published' and sp.is_listed = true
      and source_account.user_id = src.trader_user_id
      and destination_account.user_id = s.subscriber_user_id
      and (
        sp.access_mode = 'open'
        or exists (select 1 from public.social_follow_relationships r
          where r.follower_user_id = s.subscriber_user_id
            and r.followed_user_id = src.trader_user_id
            and r.status = 'accepted')
      )
  ) else false end;
$$;


-- A short service-role lease prevents two worker replicas reconciling the same subscription.
create or replace function public.claim_social_copy_subscriptions(p_worker text, p_limit integer default 20, p_lease_seconds integer default 30)
returns setof public.social_copy_subscriptions
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select s.id from public.social_copy_subscriptions s
    where s.status not in ('stopped', 'emergency_stopped')
      and (s.lease_expires_at is null or s.lease_expires_at < now() or s.lease_owner = p_worker)
    order by coalesce(s.last_reconciled_at, s.created_at), s.id
    for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.social_copy_subscriptions s set
    lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 300)))
  from candidates c where s.id = c.id returning s.*;
end;
$$;

revoke all on function public.set_social_copy_updated_at() from public, anon, authenticated;
revoke all on function public.publish_social_copy_source(uuid, text) from public, anon;
revoke all on function public.set_social_copy_source_status(uuid, text) from public, anon;
revoke all on function public.get_social_copy_sources(uuid) from public, anon;
revoke all on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb) from public, anon;
revoke all on function public.set_social_copy_subscription_status(uuid, text) from public, anon;
revoke all on function public.claim_social_copy_subscriptions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.publish_social_copy_source(uuid, text) to authenticated;
grant execute on function public.set_social_copy_source_status(uuid, text) to authenticated;
revoke all on function public.check_social_copy_subscription_authorization(uuid) from public, anon, authenticated;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;
grant execute on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.set_social_copy_subscription_status(uuid, text) to authenticated;
grant execute on function public.claim_social_copy_subscriptions(text, integer, integer) to service_role;
grant execute on function public.check_social_copy_subscription_authorization(uuid) to service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261014120000', '20261014120000_social_copy_trading', ARRAY['-- 20261014120000_social_copy_trading']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261015100000_binance_broker_accounts.sql ==========
-- Binance USD-M futures accounts. API key and secret stay service-role only.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, or binance. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists binance_account_id text,
  add column if not exists binance_environment text,
  add column if not exists binance_api_key_encrypted text,
  add column if not exists binance_api_secret_encrypted text,
  add column if not exists binance_status text,
  add column if not exists binance_margin_usdt numeric,
  add column if not exists binance_leverage integer,
  add column if not exists binance_margin_mode text;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_binance_environment_check;
alter table public.broker_accounts
  add constraint broker_accounts_binance_environment_check
    check (binance_environment is null or binance_environment in ('demo', 'live'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_binance_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_binance_status_check
    check (binance_status is null or binance_status in ('connecting', 'connected', 'error', 'disconnected'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_binance_margin_mode_check;
alter table public.broker_accounts
  add constraint broker_accounts_binance_margin_mode_check
    check (binance_margin_mode is null or binance_margin_mode in ('isolated', 'cross'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_binance_leverage_check;
alter table public.broker_accounts
  add constraint broker_accounts_binance_leverage_check
    check (binance_leverage is null or (binance_leverage between 1 and 125));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_binance_margin_usdt_check;
alter table public.broker_accounts
  add constraint broker_accounts_binance_margin_usdt_check
    check (binance_margin_usdt is null or binance_margin_usdt > 0);

comment on column public.broker_accounts.binance_account_id is
  'Stable id for the linked Binance futures key (API key fingerprint). Safe to show in the broker list.';
comment on column public.broker_accounts.binance_environment is
  'Binance futures host: demo or live.';
comment on column public.broker_accounts.binance_api_key_encrypted is
  'AES-256-GCM Binance futures API key. Service-role only.';
comment on column public.broker_accounts.binance_api_secret_encrypted is
  'AES-256-GCM Binance futures API secret. Service-role only.';
comment on column public.broker_accounts.binance_status is
  'Binance link status shown in the Connection column.';
comment on column public.broker_accounts.binance_margin_usdt is
  'USDT margin committed to each copied signal. Position notional is margin times leverage.';
comment on column public.broker_accounts.binance_leverage is
  'Initial leverage applied to the symbol before each order (1-125).';
comment on column public.broker_accounts.binance_margin_mode is
  'Futures margin mode applied to the symbol before each order: isolated or cross.';

create unique index if not exists broker_accounts_binance_account_id_idx
  on public.broker_accounts (user_id, binance_account_id)
  where binance_account_id is not null and btrim(binance_account_id) <> '';

grant select (
  binance_account_id,
  binance_environment,
  binance_status,
  binance_margin_usdt,
  binance_leverage,
  binance_margin_mode
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence Binance accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261015100000', '20261015100000_binance_broker_accounts', ARRAY['-- 20261015100000_binance_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261015120000_bybit_broker_accounts.sql ==========
-- Bybit V5 linear futures accounts. API key and secret stay service-role only.
-- Margin mode is account-wide on a Unified account, so it is read live and not stored.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, binance, or bybit. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists bybit_account_id text,
  add column if not exists bybit_environment text,
  add column if not exists bybit_api_key_encrypted text,
  add column if not exists bybit_api_secret_encrypted text,
  add column if not exists bybit_status text,
  add column if not exists bybit_margin_usdt numeric,
  add column if not exists bybit_leverage integer;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_bybit_environment_check;
alter table public.broker_accounts
  add constraint broker_accounts_bybit_environment_check
    check (bybit_environment is null or bybit_environment in ('demo', 'live'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_bybit_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_bybit_status_check
    check (bybit_status is null or bybit_status in ('connecting', 'connected', 'error', 'disconnected'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_bybit_leverage_check;
alter table public.broker_accounts
  add constraint broker_accounts_bybit_leverage_check
    check (bybit_leverage is null or (bybit_leverage between 1 and 125));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_bybit_margin_usdt_check;
alter table public.broker_accounts
  add constraint broker_accounts_bybit_margin_usdt_check
    check (bybit_margin_usdt is null or bybit_margin_usdt > 0);

comment on column public.broker_accounts.bybit_account_id is
  'Stable id for the linked Bybit key (API key fingerprint). Safe to show in the broker list.';
comment on column public.broker_accounts.bybit_environment is
  'Bybit host: demo (api-demo.bybit.com) or live (api.bybit.com).';
comment on column public.broker_accounts.bybit_api_key_encrypted is
  'AES-256-GCM Bybit API key. Service-role only.';
comment on column public.broker_accounts.bybit_api_secret_encrypted is
  'AES-256-GCM Bybit API secret. Service-role only.';
comment on column public.broker_accounts.bybit_status is
  'Bybit link status shown in the Connection column.';
comment on column public.broker_accounts.bybit_margin_usdt is
  'Quote-currency margin committed to each copied signal. Position notional is margin times leverage.';
comment on column public.broker_accounts.bybit_leverage is
  'Leverage applied to the symbol before each order (1-125, capped by the symbol maximum).';

create unique index if not exists broker_accounts_bybit_account_id_idx
  on public.broker_accounts (user_id, bybit_account_id)
  where bybit_account_id is not null and btrim(bybit_account_id) <> '';

grant select (
  bybit_account_id,
  bybit_environment,
  bybit_status,
  bybit_margin_usdt,
  bybit_leverage
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence Bybit accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    when 'bybit' then nullif(btrim(account_row.bybit_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261015120000', '20261015120000_bybit_broker_accounts', ARRAY['-- 20261015120000_bybit_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261015130000_social_reviews_trade_history.sql ==========
-- Persisted trader reviews and an explicitly consented, narrow view of genuine
-- TScopier-recorded trade history. Broker credentials and account identifiers
-- are never returned by these functions.

alter table public.social_profiles
  add column if not exists share_trade_history boolean not null default false;

create table public.social_trader_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  trader_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null check (
    char_length(btrim(review_text)) between 1 and 2000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_trader_reviews_not_self check (reviewer_user_id <> trader_user_id),
  constraint social_trader_reviews_pair_unique unique (reviewer_user_id, trader_user_id)
);

create index social_trader_reviews_trader_idx
  on public.social_trader_reviews (trader_user_id, updated_at desc);

create trigger social_trader_reviews_updated_at
  before update on public.social_trader_reviews
  for each row execute function public.set_social_updated_at();

alter table public.social_trader_reviews enable row level security;

revoke all on table public.social_trader_reviews from anon, authenticated;
grant insert, update, delete on table public.social_trader_reviews to authenticated;
grant all on table public.social_trader_reviews to service_role;

create policy "Review authors can insert their own review"
  on public.social_trader_reviews for insert to authenticated
  with check (
    reviewer_user_id = auth.uid()
    and trader_user_id <> auth.uid()
    and exists (
      select 1 from public.social_profiles sp
      where sp.user_id = trader_user_id and sp.is_listed = true
    )
  );

create policy "Review authors can update their own review"
  on public.social_trader_reviews for update to authenticated
  using (reviewer_user_id = auth.uid())
  with check (
    reviewer_user_id = auth.uid() and trader_user_id <> auth.uid()
    and exists (select 1 from public.social_profiles sp
      where sp.user_id = trader_user_id and sp.is_listed = true)
  );


create policy "Review authors can delete their own review"
  on public.social_trader_reviews for delete to authenticated
  using (reviewer_user_id = auth.uid());

create or replace function public.upsert_social_trader_review(
  p_trader_user_id uuid,
  p_rating integer,
  p_review_text text
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid; v_text text := btrim(coalesce(p_review_text, ''));
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_trader_user_id is null then raise exception 'Trader user id is required' using errcode = '22004'; end if;
  if p_trader_user_id = v_actor then raise exception 'Users cannot review themselves' using errcode = '23514'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'Review text must contain between 1 and 2000 characters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.social_profiles sp
    where sp.user_id = p_trader_user_id and sp.is_listed = true
  ) then raise exception 'Social profile is not available' using errcode = 'P0002'; end if;

  insert into public.social_trader_reviews (reviewer_user_id, trader_user_id, rating, review_text)
  values (v_actor, p_trader_user_id, p_rating, v_text)
  on conflict (reviewer_user_id, trader_user_id) do update
    set rating = excluded.rating, review_text = excluded.review_text
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_social_trader_review(p_trader_user_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  delete from public.social_trader_reviews
  where reviewer_user_id = v_actor and trader_user_id = p_trader_user_id;
  if not found then raise exception 'Review was not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.get_social_trader_reviews(p_trader_user_id uuid)
returns table (
  review_id uuid,
  rating smallint,
  review_text text,
  reviewer_display_name text,
  reviewer_username text,
  is_own boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.social_profiles sp
    where sp.user_id = p_trader_user_id and sp.is_listed = true
  ) then raise exception 'Social profile is not available' using errcode = 'P0002'; end if;

  return query
  select r.id, r.rating, r.review_text,
    case when reviewer_social.is_listed = true
      then coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), ''))
      else null end,
    case when reviewer_social.is_listed = true then nullif(btrim(up.username), '') else null end,
    r.reviewer_user_id = v_actor,
    r.created_at, r.updated_at
  from public.social_trader_reviews r
  left join public.social_profiles reviewer_social on reviewer_social.user_id = r.reviewer_user_id
  left join public.user_profiles up on up.user_id = r.reviewer_user_id
  where r.trader_user_id = p_trader_user_id
  order by (r.reviewer_user_id = v_actor) desc, r.updated_at desc, r.id;
end;
$$;

-- Extend the existing safe directory RPC with persisted review aggregates.
drop function public.get_social_directory();
create function public.get_social_directory()
returns table (
  profile_user_id uuid,
  display_name text,
  username text,
  country text,
  access_mode text,
  is_self boolean,
  follower_count bigint,
  following_count bigint,
  viewer_relationship_status text,
  follows_viewer_status text,
  average_rating numeric,
  review_count bigint,
  viewer_rating smallint,
  shares_trade_history boolean
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select sp.user_id,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')),
    coalesce(nullif(btrim(up.username), ''), ''),
    coalesce(nullif(btrim(up.country), ''), ''),
    sp.access_mode, sp.user_id = v_actor,
    (select count(*) from public.social_follow_relationships incoming
      join public.social_profiles ip on ip.user_id = incoming.follower_user_id
      join public.user_profiles ii on ii.user_id = incoming.follower_user_id
      where incoming.followed_user_id = sp.user_id and incoming.status = 'accepted'
        and ip.is_listed = true
        and coalesce(nullif(btrim(ii.display_name), ''), nullif(btrim(ii.username), '')) is not null),
    (select count(*) from public.social_follow_relationships outgoing_count
      join public.social_profiles fp on fp.user_id = outgoing_count.followed_user_id
      join public.user_profiles fi on fi.user_id = outgoing_count.followed_user_id
      where outgoing_count.follower_user_id = sp.user_id and outgoing_count.status = 'accepted'
        and fp.is_listed = true
        and coalesce(nullif(btrim(fi.display_name), ''), nullif(btrim(fi.username), '')) is not null),
    outgoing.status, incoming_viewer.status,
    (select round(avg(r.rating)::numeric, 2) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select count(*) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select r.rating from public.social_trader_reviews r where r.trader_user_id = sp.user_id and r.reviewer_user_id = v_actor),
    sp.share_trade_history
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join public.social_follow_relationships outgoing
    on outgoing.follower_user_id = v_actor and outgoing.followed_user_id = sp.user_id
  left join public.social_follow_relationships incoming_viewer
    on incoming_viewer.follower_user_id = sp.user_id and incoming_viewer.followed_user_id = v_actor
  where sp.is_listed = true
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  order by 7 desc, 2 asc, 1 asc;
end;
$$;

create or replace function public.set_social_trade_history_sharing(p_enabled boolean)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  update public.social_profiles set share_trade_history = coalesce(p_enabled, false)
  where user_id = v_actor and is_listed = true;
  if not found then raise exception 'Social profile is not registered' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.get_social_trade_history_access(p_trader_user_id uuid)
returns table (sharing_enabled boolean, can_view boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_profile public.social_profiles%rowtype;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_profile from public.social_profiles
  where user_id = p_trader_user_id and is_listed = true;
  if not found then raise exception 'Social profile is not available' using errcode = 'P0002'; end if;
  return query select v_profile.share_trade_history,
    (v_actor = p_trader_user_id or (
      v_profile.share_trade_history and (
        v_profile.access_mode = 'open' or exists (
          select 1 from public.social_follow_relationships r
          where r.follower_user_id = v_actor and r.followed_user_id = p_trader_user_id and r.status = 'accepted'
        )
      )
    ));
end;
$$;

create or replace function public.get_social_trade_history(p_trader_user_id uuid, p_limit integer default 100)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_allowed boolean;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select a.can_view into v_allowed from public.get_social_trade_history_access(p_trader_user_id) a;
  if not coalesce(v_allowed, false) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;
  return query
  select t.id, t.symbol, lower(t.direction),
    case when t.closed_at is not null or lower(t.status) = 'closed' then 'closed' else 'open' end,
    t.opened_at, t.closed_at,
    case when t.closed_at is not null or lower(t.status) = 'closed' then t.profit else null end
  from public.trades t
  where t.user_id = p_trader_user_id
    and (lower(t.status) = 'open' or t.closed_at is not null or lower(t.status) = 'closed')
  order by coalesce(t.closed_at, t.opened_at) desc, t.id
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.upsert_social_trader_review(uuid, integer, text) from public, anon;
revoke all on function public.delete_social_trader_review(uuid) from public, anon;
revoke all on function public.get_social_trader_reviews(uuid) from public, anon;
revoke all on function public.get_social_directory() from public, anon;
revoke all on function public.set_social_trade_history_sharing(boolean) from public, anon;
revoke all on function public.get_social_trade_history_access(uuid) from public, anon;
revoke all on function public.get_social_trade_history(uuid, integer) from public, anon;
grant execute on function public.upsert_social_trader_review(uuid, integer, text) to authenticated;
grant execute on function public.delete_social_trader_review(uuid) to authenticated;
grant execute on function public.get_social_trader_reviews(uuid) to authenticated;
grant execute on function public.get_social_directory() to authenticated;
grant execute on function public.set_social_trade_history_sharing(boolean) to authenticated;
grant execute on function public.get_social_trade_history_access(uuid) to authenticated;
grant execute on function public.get_social_trade_history(uuid, integer) to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261015130000', '20261015130000_social_reviews_trade_history', ARRAY['-- 20261015130000_social_reviews_trade_history']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261015140000_kucoin_broker_accounts.sql ==========
-- KuCoin Futures (classic API) accounts. API key, secret and passphrase stay service-role only.
-- Margin mode is chosen by the user and applied per symbol before each order.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, binance, bybit, or kucoin. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists kucoin_account_id text,
  add column if not exists kucoin_api_key_encrypted text,
  add column if not exists kucoin_api_secret_encrypted text,
  add column if not exists kucoin_passphrase_encrypted text,
  add column if not exists kucoin_status text,
  add column if not exists kucoin_margin_usdt numeric,
  add column if not exists kucoin_leverage integer,
  add column if not exists kucoin_margin_mode text;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_kucoin_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_kucoin_status_check
    check (kucoin_status is null or kucoin_status in ('connecting', 'connected', 'error', 'disconnected'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_kucoin_leverage_check;
alter table public.broker_accounts
  add constraint broker_accounts_kucoin_leverage_check
    check (kucoin_leverage is null or (kucoin_leverage between 1 and 125));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_kucoin_margin_usdt_check;
alter table public.broker_accounts
  add constraint broker_accounts_kucoin_margin_usdt_check
    check (kucoin_margin_usdt is null or kucoin_margin_usdt > 0);

alter table public.broker_accounts
  drop constraint if exists broker_accounts_kucoin_margin_mode_check;
alter table public.broker_accounts
  add constraint broker_accounts_kucoin_margin_mode_check
    check (kucoin_margin_mode is null or kucoin_margin_mode in ('isolated', 'cross'));

comment on column public.broker_accounts.kucoin_account_id is
  'Stable id for the linked KuCoin key (API key fingerprint). Safe to show in the broker list.';
comment on column public.broker_accounts.kucoin_api_key_encrypted is
  'AES-256-GCM KuCoin API key. Service-role only.';
comment on column public.broker_accounts.kucoin_api_secret_encrypted is
  'AES-256-GCM KuCoin API secret. Service-role only.';
comment on column public.broker_accounts.kucoin_passphrase_encrypted is
  'AES-256-GCM KuCoin API passphrase. Service-role only.';
comment on column public.broker_accounts.kucoin_status is
  'KuCoin link status shown in the Connection column.';
comment on column public.broker_accounts.kucoin_margin_usdt is
  'Quote-currency margin committed to each copied signal. Position notional is margin times leverage.';
comment on column public.broker_accounts.kucoin_leverage is
  'Leverage applied to the symbol before each order (1-125, capped by the symbol maximum).';
comment on column public.broker_accounts.kucoin_margin_mode is
  'Margin mode applied per symbol before each order: isolated or cross.';

create unique index if not exists broker_accounts_kucoin_account_id_idx
  on public.broker_accounts (user_id, kucoin_account_id)
  where kucoin_account_id is not null and btrim(kucoin_account_id) <> '';

grant select (
  kucoin_account_id,
  kucoin_status,
  kucoin_margin_usdt,
  kucoin_leverage,
  kucoin_margin_mode
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence KuCoin accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    when 'bybit' then nullif(btrim(account_row.bybit_account_id), '')
    when 'kucoin' then nullif(btrim(account_row.kucoin_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261015140000', '20261015140000_kucoin_broker_accounts', ARRAY['-- 20261015140000_kucoin_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261015160000_landing_announcements.sql ==========
/*
  # landing_announcements — the announcement tag in the marketing hero

  Public (anon-readable) because the landing page is shown to signed-out visitors.
  The page shows the newest row that is active and inside its optional start/end window,
  so publishing news is just inserting a row (and `is_active = false` or `ends_at` retires one).

  - message:      default text (shown when there is no translation for the visitor's locale)
  - translations: optional {"es": "...", "fr": "..."} overrides, keyed by locale code
  - link_href:    optional internal path (/pricing) or external URL; makes the tag clickable
  - link_label:   optional accessible label for the link

  No insert/update/delete policies on purpose: only the service role (or the Supabase
  dashboard / SQL editor) can publish announcements; clients are read-only.
*/

create table if not exists public.landing_announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(btrim(message)) > 0),
  translations jsonb not null default '{}'::jsonb,
  link_href text,
  link_label text,
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists landing_announcements_live_idx
  on public.landing_announcements (starts_at desc)
  where is_active;

alter table public.landing_announcements enable row level security;

drop policy if exists "Anyone can read live landing announcements" on public.landing_announcements;
create policy "Anyone can read live landing announcements"
  on public.landing_announcements for select
  to anon, authenticated
  using (is_active and starts_at <= now() and (ends_at is null or ends_at > now()));

comment on table public.landing_announcements is
  'Marketing hero announcement tag. The newest active row inside its starts_at/ends_at window is shown.';

insert into public.landing_announcements (message, translations)
select
  'TScopier.ai is now UniCopier',
  jsonb_build_object(
    'es', 'TScopier.ai ahora es UniCopier',
    'fr', 'TScopier.ai devient UniCopier',
    'ar', 'أصبح TScopier.ai الآن UniCopier',
    'ja', 'TScopier.aiは UniCopier になりました',
    'nl', 'TScopier.ai is nu UniCopier',
    'pl', 'TScopier.ai to teraz UniCopier',
    'ru', 'TScopier.ai теперь UniCopier',
    'sv', 'TScopier.ai är nu UniCopier'
  )
where not exists (select 1 from public.landing_announcements);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261015160000', '20261015160000_landing_announcements', ARRAY['-- 20261015160000_landing_announcements']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261018170000_mirror_copy_engine.sql ==========
-- Mirror copy trading engine: worker state, trade ledger, action log, and claim function.
--
-- Same-owner copying (one master broker account -> many slave accounts). This is
-- deliberately separate from social copy trading (cross-user): mirror needs no
-- authorization boundary, but it does need worker-owned lifecycle state kept apart
-- from the user-owned configuration in broker_copy_links.
--
-- Nothing here executes a trade by itself. The worker only reads these tables when
-- its execution flag is on; with the flag off it records intent and touches no broker.

-- ---------------------------------------------------------------------------
-- Master state: one row per account being copied from.
-- Holds the worker lease so two replicas never reconcile the same master at once.
-- ---------------------------------------------------------------------------
create table if not exists public.mirror_copy_master_state (
  broker_account_id uuid primary key references public.broker_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'error')),
  error_code text,
  error_detail text,
  lease_owner text,
  lease_expires_at timestamptz,
  last_snapshot_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mirror_copy_master_state is
  'Worker-owned lease and reconcile state for a mirror-copy master account. Holds no broker credentials.';

-- ---------------------------------------------------------------------------
-- Link state: one row per master->slave link.
-- Kept out of broker_copy_links so worker writes never race the user's settings saves.
-- desired_status is what the user wants; status is what the worker is doing.
-- ---------------------------------------------------------------------------
create table if not exists public.mirror_copy_link_state (
  link_id uuid primary key references public.broker_copy_links(id) on delete cascade,
  desired_status text not null default 'paused' check (desired_status in ('active', 'paused', 'stopped')),
  status text not null default 'pending' check (
    status in ('pending', 'active', 'paused', 'stopped', 'error', 'unsupported_provider')
  ),
  error_code text,
  error_detail text,
  worker_acknowledged_at timestamptz,
  last_reconciled_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mirror_copy_link_state is
  'Worker-owned lifecycle state for a mirror-copy link. Defaults to paused until the worker acknowledges it.';

-- ---------------------------------------------------------------------------
-- Trade ledger: one row per copied trade (master ticket -> slave ticket).
-- This is what lets the worker survive a restart and never copy a trade twice.
-- ---------------------------------------------------------------------------
create table if not exists public.mirror_copy_trade_mappings (
  id uuid primary key default gen_random_uuid(),
  -- Cascade, not restrict: broker_copy_links rows are hard-deleted by the existing
  -- config UI, and an unmanaged copy has no meaning once its link is gone.
  link_id uuid not null references public.broker_copy_links(id) on delete cascade,
  source_ticket text not null,
  destination_ticket text,
  source_symbol text not null,
  destination_symbol text not null,
  source_side text not null check (source_side in ('buy', 'sell')),
  source_volume numeric not null check (source_volume > 0),
  destination_volume numeric not null check (destination_volume > 0),
  source_stop_loss numeric,
  source_take_profit numeric,
  state text not null default 'opening' check (
    state in ('opening', 'open', 'closing', 'closed', 'uncertain', 'error')
  ),
  broker_comment text not null,
  opened_at timestamptz,
  closed_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, source_ticket),
  unique (link_id, broker_comment)
);

comment on table public.mirror_copy_trade_mappings is
  'Links a master ticket to its copied slave ticket for one mirror link. Enforces one copy per source ticket.';

-- ---------------------------------------------------------------------------
-- Action log: one row per intended broker action, written before it is sent.
-- The unique (link_id, idempotency_key) is the duplicate protection.
-- ---------------------------------------------------------------------------
create table if not exists public.mirror_copy_execution_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.broker_copy_links(id) on delete cascade,
  mapping_id uuid references public.mirror_copy_trade_mappings(id) on delete cascade,
  source_ticket text not null,
  action text not null check (action in ('open', 'modify', 'close', 'unsupported', 'reconcile')),
  idempotency_key text not null,
  status text not null default 'claimed' check (
    status in ('claimed', 'succeeded', 'failed', 'uncertain', 'skipped')
  ),
  attempt_count integer not null default 1 check (attempt_count > 0),
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (link_id, idempotency_key)
);

comment on table public.mirror_copy_execution_events is
  'Durable audit and idempotency record for mirror-copy broker actions. A failed action may be re-claimed; any other status blocks a repeat.';

create index if not exists mirror_copy_master_state_claim_idx
  on public.mirror_copy_master_state (status, lease_expires_at);
create index if not exists mirror_copy_link_state_worker_idx
  on public.mirror_copy_link_state (desired_status, status);
create index if not exists mirror_copy_trade_mappings_open_idx
  on public.mirror_copy_trade_mappings (link_id, state);
create index if not exists mirror_copy_execution_events_link_idx
  on public.mirror_copy_execution_events (link_id, created_at desc);
create index if not exists mirror_copy_execution_events_mapping_idx
  on public.mirror_copy_execution_events (mapping_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_mirror_copy_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists mirror_copy_master_state_updated_at on public.mirror_copy_master_state;
create trigger mirror_copy_master_state_updated_at before update on public.mirror_copy_master_state
  for each row execute function public.set_mirror_copy_updated_at();
drop trigger if exists mirror_copy_link_state_updated_at on public.mirror_copy_link_state;
create trigger mirror_copy_link_state_updated_at before update on public.mirror_copy_link_state
  for each row execute function public.set_mirror_copy_updated_at();
drop trigger if exists mirror_copy_trade_mappings_updated_at on public.mirror_copy_trade_mappings;
create trigger mirror_copy_trade_mappings_updated_at before update on public.mirror_copy_trade_mappings
  for each row execute function public.set_mirror_copy_updated_at();
drop trigger if exists mirror_copy_execution_events_updated_at on public.mirror_copy_execution_events;
create trigger mirror_copy_execution_events_updated_at before update on public.mirror_copy_execution_events
  for each row execute function public.set_mirror_copy_updated_at();

-- ---------------------------------------------------------------------------
-- Seed state rows whenever a link is created, so the UI can show status before
-- the worker's next run and the claim function always has a master row.
-- Links start paused and are activated deliberately through
-- set_mirror_copy_link_status(); this keeps a config change from starting live copying.
-- ---------------------------------------------------------------------------
create or replace function public.mirror_copy_link_after_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.mirror_copy_link_state (link_id)
    values (new.id)
    on conflict (link_id) do nothing;
  insert into public.mirror_copy_master_state (broker_account_id)
    values (new.source_broker_account_id)
    on conflict (broker_account_id) do nothing;
  return new;
end;
$$;

drop trigger if exists mirror_copy_link_after_insert on public.broker_copy_links;
create trigger mirror_copy_link_after_insert after insert on public.broker_copy_links
  for each row execute function public.mirror_copy_link_after_insert();

-- Backfill state for any links that already existed before this migration, so the
-- claim function has a master row and the UI has a link state row for every link.
insert into public.mirror_copy_link_state (link_id)
  select id from public.broker_copy_links
  on conflict (link_id) do nothing;
insert into public.mirror_copy_master_state (broker_account_id)
  select distinct source_broker_account_id from public.broker_copy_links
  on conflict (broker_account_id) do nothing;

-- ---------------------------------------------------------------------------
-- Claim function: hand each worker a share of the masters under a short lease.
-- Service-role only. Mirrors claim_social_copy_subscriptions.
-- ---------------------------------------------------------------------------
create or replace function public.claim_mirror_copy_masters(
  p_worker text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns setof public.mirror_copy_master_state
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- Access control is the GRANT below (execute is revoked from public/anon/authenticated
  -- and granted only to service_role). An in-body current_user check would be useless
  -- here: inside a SECURITY DEFINER function current_user is the function owner, not the
  -- caller, so it would silently pass for any role if the grant were ever widened.
  return query
  with candidates as (
    select m.broker_account_id
    from public.mirror_copy_master_state m
    where exists (
        select 1 from public.broker_copy_links l
        where l.source_broker_account_id = m.broker_account_id
      )
      and (m.lease_expires_at is null or m.lease_expires_at < now() or m.lease_owner = p_worker)
    order by coalesce(m.last_reconciled_at, m.created_at), m.broker_account_id
    for update skip locked
    limit greatest(1, least(p_limit, 200))
  )
  update public.mirror_copy_master_state m set
    lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 300)))
  from candidates c
  where m.broker_account_id = c.broker_account_id
  returning m.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- User-facing lifecycle switch (activate / pause / stop). This is the only way a
-- user changes desired_status; the worker alone writes the current `status`.
-- ---------------------------------------------------------------------------
create or replace function public.set_mirror_copy_link_status(p_link_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_status is null or p_status not in ('active', 'paused', 'stopped') then
    raise exception 'invalid mirror copy status: %', p_status using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.broker_copy_links l
    where l.id = p_link_id
      and (l.user_id = auth.uid() or auth.role() = 'service_role')
  ) then
    raise exception 'not authorized for this mirror copy link' using errcode = '42501';
  end if;
  insert into public.mirror_copy_link_state (link_id, desired_status)
    values (p_link_id, p_status)
    on conflict (link_id) do update set desired_status = excluded.desired_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: worker writes everything; a user may only read their own link state,
-- plus call the lifecycle RPC above for their own links.
-- ---------------------------------------------------------------------------
alter table public.mirror_copy_master_state enable row level security;
alter table public.mirror_copy_link_state enable row level security;
alter table public.mirror_copy_trade_mappings enable row level security;
alter table public.mirror_copy_execution_events enable row level security;

revoke all on table public.mirror_copy_master_state from anon, authenticated;
revoke all on table public.mirror_copy_link_state from anon, authenticated;
revoke all on table public.mirror_copy_trade_mappings from anon, authenticated;
revoke all on table public.mirror_copy_execution_events from anon, authenticated;

grant all on table public.mirror_copy_master_state to service_role;
grant all on table public.mirror_copy_link_state to service_role;
grant all on table public.mirror_copy_trade_mappings to service_role;
grant all on table public.mirror_copy_execution_events to service_role;

grant select on table public.mirror_copy_link_state to authenticated;

drop policy if exists "Users can view own mirror copy link state" on public.mirror_copy_link_state;
create policy "Users can view own mirror copy link state"
  on public.mirror_copy_link_state for select to authenticated
  using (exists (
    select 1 from public.broker_copy_links l
    where l.id = link_id and l.user_id = auth.uid()
  ));

revoke all on function public.set_mirror_copy_updated_at() from public, anon, authenticated;
revoke all on function public.mirror_copy_link_after_insert() from public, anon, authenticated;
revoke all on function public.claim_mirror_copy_masters(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_mirror_copy_masters(text, integer, integer) to service_role;

revoke all on function public.set_mirror_copy_link_status(uuid, text) from public, anon;
grant execute on function public.set_mirror_copy_link_status(uuid, text) to authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261018170000', '20261018170000_mirror_copy_engine', ARRAY['-- 20261018170000_mirror_copy_engine']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261018180000_broker_accounts_margin_mode.sql ==========
-- Margin/execution mode of a broker account (hedging vs netting).
--
-- Mirror copy must know this before it trusts open/close semantics: on a netting
-- account a second position on the same symbol merges into the first, so a naive
-- "open a copy" would be wrong. Defaults to 'unknown' (fail closed): the mirror
-- engine refuses to copy until the mode is known.
--
-- Written by the worker from the MT platform account summary, alongside
-- linked_account_type.

alter table public.broker_accounts
  add column if not exists margin_mode text not null default 'unknown'
  check (margin_mode in ('hedging', 'netting', 'unknown'));

comment on column public.broker_accounts.margin_mode is
  'Hedging vs netting execution mode, written by the worker from the MT platform account summary. unknown = not yet determined; mirror copy refuses to run until it is known.';

-- Table-level SELECT was revoked; grant the new column explicitly.
grant select (margin_mode) on public.broker_accounts to authenticated;

-- margin_mode is worker-owned: keep it read-only for authenticated/anon by extending the
-- existing credential guard trigger. The body below MUST reproduce the latest guard
-- (see 20261015140000_kucoin_broker_accounts.sql) verbatim, plus the margin_mode lines.
-- This migration runs last, so a partial body would silently drop protection for every
-- credential column added earlier (binance/bybit/kucoin/ctrader/mtapi).
create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
    new.margin_mode := 'unknown';
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
    new.margin_mode := old.margin_mode;
  end if;
  return new;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261018180000', '20261018180000_broker_accounts_margin_mode', ARRAY['-- 20261018180000_broker_accounts_margin_mode']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261019090000_dxtrade_broker_accounts.sql ==========
-- DXtrade (white-label forex/CFD platform) accounts. Each broker hosts its own REST server, so the
-- trader supplies server URL, username, domain and password. The password stays service-role only.
-- Copying targets position-based (hedging) accounts, where every trade has its own positionCode.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, binance, bybit, kucoin, or dxtrade. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists dxtrade_account_id text,
  add column if not exists dxtrade_server_url text,
  add column if not exists dxtrade_username text,
  add column if not exists dxtrade_domain text,
  add column if not exists dxtrade_password_encrypted text,
  add column if not exists dxtrade_account_code text,
  add column if not exists dxtrade_status text,
  add column if not exists dxtrade_is_position_based boolean;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_dxtrade_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_dxtrade_status_check
    check (dxtrade_status is null or dxtrade_status in ('connecting', 'connected', 'error', 'disconnected'));

comment on column public.broker_accounts.dxtrade_account_id is
  'Stable id for the linked DXtrade account (fingerprint of server, login and account code). Safe to show in the broker list.';
comment on column public.broker_accounts.dxtrade_server_url is
  'Broker DXtrade REST base URL (https, ending in /dxsca-web).';
comment on column public.broker_accounts.dxtrade_username is
  'DXtrade login (without the domain).';
comment on column public.broker_accounts.dxtrade_domain is
  'DXtrade login domain, usually default.';
comment on column public.broker_accounts.dxtrade_password_encrypted is
  'AES-256-GCM DXtrade password. Service-role only.';
comment on column public.broker_accounts.dxtrade_account_code is
  'DXtrade account code in clearing:account format.';
comment on column public.broker_accounts.dxtrade_status is
  'DXtrade link status shown in the Connection column.';
comment on column public.broker_accounts.dxtrade_is_position_based is
  'True when the account is position-based (hedging). Net-based accounts are rejected at link time.';

create unique index if not exists broker_accounts_dxtrade_account_id_idx
  on public.broker_accounts (user_id, dxtrade_account_id)
  where dxtrade_account_id is not null and btrim(dxtrade_account_id) <> '';

grant select (
  dxtrade_account_id,
  dxtrade_server_url,
  dxtrade_username,
  dxtrade_domain,
  dxtrade_account_code,
  dxtrade_status,
  dxtrade_is_position_based
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
    new.dxtrade_password_encrypted := null;
    new.dxtrade_account_id := null;
    new.dxtrade_server_url := null;
    new.dxtrade_username := null;
    new.dxtrade_domain := null;
    new.dxtrade_account_code := null;
    new.dxtrade_is_position_based := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
    new.dxtrade_password_encrypted := old.dxtrade_password_encrypted;
    new.dxtrade_account_id := old.dxtrade_account_id;
    new.dxtrade_server_url := old.dxtrade_server_url;
    new.dxtrade_username := old.dxtrade_username;
    new.dxtrade_domain := old.dxtrade_domain;
    new.dxtrade_account_code := old.dxtrade_account_code;
    new.dxtrade_is_position_based := old.dxtrade_is_position_based;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence DXtrade accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    when 'bybit' then nullif(btrim(account_row.bybit_account_id), '')
    when 'kucoin' then nullif(btrim(account_row.kucoin_account_id), '')
    when 'dxtrade' then nullif(btrim(account_row.dxtrade_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261019090000', '20261019090000_dxtrade_broker_accounts', ARRAY['-- 20261019090000_dxtrade_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261019120000_tradelocker_broker_accounts.sql ==========
-- TradeLocker accounts. Each trader links their own login (email, password, broker server name) on the
-- demo or live TradeLocker environment. The password stays service-role only. TradeLocker's public REST
-- API hosts are fixed per environment, so no server URL is stored.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, binance, bybit, kucoin, dxtrade, or tradelocker. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists tradelocker_account_id text,
  add column if not exists tradelocker_environment text,
  add column if not exists tradelocker_server text,
  add column if not exists tradelocker_email text,
  add column if not exists tradelocker_password_encrypted text,
  add column if not exists tradelocker_account_ref text,
  add column if not exists tradelocker_acc_num integer,
  add column if not exists tradelocker_status text;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_tradelocker_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_tradelocker_status_check
    check (tradelocker_status is null or tradelocker_status in ('connecting', 'connected', 'error', 'disconnected'));

alter table public.broker_accounts
  drop constraint if exists broker_accounts_tradelocker_environment_check;
alter table public.broker_accounts
  add constraint broker_accounts_tradelocker_environment_check
    check (tradelocker_environment is null or tradelocker_environment in ('demo', 'live'));

comment on column public.broker_accounts.tradelocker_account_id is
  'Stable id for the linked TradeLocker account (fingerprint of environment, server, email and account id). Safe to show in the broker list.';
comment on column public.broker_accounts.tradelocker_environment is
  'TradeLocker environment: demo (demo.tradelocker.com) or live (live.tradelocker.com).';
comment on column public.broker_accounts.tradelocker_server is
  'Broker server name used on the TradeLocker web login.';
comment on column public.broker_accounts.tradelocker_email is
  'TradeLocker login email.';
comment on column public.broker_accounts.tradelocker_password_encrypted is
  'AES-256-GCM TradeLocker password. Service-role only.';
comment on column public.broker_accounts.tradelocker_account_ref is
  'TradeLocker accountId (path parameter of /trade/accounts/{accountId}).';
comment on column public.broker_accounts.tradelocker_acc_num is
  'TradeLocker accNum, sent as the accNum header on every /trade call.';
comment on column public.broker_accounts.tradelocker_status is
  'TradeLocker link status shown in the Connection column.';

create unique index if not exists broker_accounts_tradelocker_account_id_idx
  on public.broker_accounts (user_id, tradelocker_account_id)
  where tradelocker_account_id is not null and btrim(tradelocker_account_id) <> '';

grant select (
  tradelocker_account_id,
  tradelocker_environment,
  tradelocker_server,
  tradelocker_email,
  tradelocker_account_ref,
  tradelocker_acc_num,
  tradelocker_status
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
    new.dxtrade_password_encrypted := null;
    new.dxtrade_account_id := null;
    new.dxtrade_server_url := null;
    new.dxtrade_username := null;
    new.dxtrade_domain := null;
    new.dxtrade_account_code := null;
    new.dxtrade_is_position_based := null;
    new.tradelocker_password_encrypted := null;
    new.tradelocker_account_id := null;
    new.tradelocker_environment := null;
    new.tradelocker_server := null;
    new.tradelocker_email := null;
    new.tradelocker_account_ref := null;
    new.tradelocker_acc_num := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
    new.dxtrade_password_encrypted := old.dxtrade_password_encrypted;
    new.dxtrade_account_id := old.dxtrade_account_id;
    new.dxtrade_server_url := old.dxtrade_server_url;
    new.dxtrade_username := old.dxtrade_username;
    new.dxtrade_domain := old.dxtrade_domain;
    new.dxtrade_account_code := old.dxtrade_account_code;
    new.dxtrade_is_position_based := old.dxtrade_is_position_based;
    new.tradelocker_password_encrypted := old.tradelocker_password_encrypted;
    new.tradelocker_account_id := old.tradelocker_account_id;
    new.tradelocker_environment := old.tradelocker_environment;
    new.tradelocker_server := old.tradelocker_server;
    new.tradelocker_email := old.tradelocker_email;
    new.tradelocker_account_ref := old.tradelocker_account_ref;
    new.tradelocker_acc_num := old.tradelocker_acc_num;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence TradeLocker accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    when 'bybit' then nullif(btrim(account_row.bybit_account_id), '')
    when 'kucoin' then nullif(btrim(account_row.kucoin_account_id), '')
    when 'dxtrade' then nullif(btrim(account_row.dxtrade_account_id), '')
    when 'tradelocker' then nullif(btrim(account_row.tradelocker_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261019120000', '20261019120000_tradelocker_broker_accounts', ARRAY['-- 20261019120000_tradelocker_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261019121000_social_provider_performance_foundation.sql ==========
-- Social provider performance foundation.
--
-- Canonical scope: social_copy_sources.broker_account_id -> broker_accounts.id
-- -> trades.broker_account_id.  This deliberately reports only TSCopier-managed
-- trades persisted for the explicitly published source account.  It is not a
-- claim that public.trades is a complete broker ledger.
--
-- Methodology:
-- * realized P/L is the broker-reported value persisted in trades.profit for
--   closed rows. The bridge prefers netProfit when supplied, but commissions,
--   swap and fees are not independently itemised, so no stronger fee claim is
--   made here;
-- * trade count is the number of deduplicated closed broker positions with a
--   complete realized P/L; win rate is profitable closed positions divided by
--   all closed positions (break-even positions remain in the denominator);
-- * profit factor is gross positive P/L / absolute gross negative P/L and is
--   unavailable when there are no losing positions;
-- * return percentage, maximum drawdown and an equity curve remain unavailable.
--   public.trades has neither cash-flow history nor periodic equity snapshots,
--   so deriving those values from current balance would be misleading.
--
-- History rows created by social copying are excluded by destination ticket.
-- The current social-copy worker does not insert them into public.trades, but
-- the exclusion keeps the rule true if destination executions are persisted in
-- that table later. Historical duplicate broker tickets are collapsed because
-- the uniqueness guard only covers rows created since 2026-08-05.

create index if not exists trades_social_performance_scope_idx
  on public.trades (broker_account_id, status, opened_at, id)
  where broker_account_id is not null;

-- The initial product contract exposes one selected source account per social
-- profile. Preserve older source rows for audit/history, but make only the most
-- recently updated source visible as published before enforcing the invariant.
with ranked_sources as (
  select id, row_number() over (
    partition by trader_user_id
    order by updated_at desc, created_at desc, id desc
  ) as source_rank
  from public.social_copy_sources
  where status = 'published'
)
update public.social_copy_sources source
set status = 'paused', updated_at = now()
from ranked_sources ranked
where source.id = ranked.id and ranked.source_rank > 1;

update public.social_copy_subscriptions subscription
set desired_status = 'paused', updated_at = now()
from public.social_copy_sources source
where source.id = subscription.source_id
  and source.status = 'paused'
  and subscription.status in ('pending', 'active');

create unique index if not exists social_copy_sources_one_published_per_trader_idx
  on public.social_copy_sources (trader_user_id)
  where status = 'published';

comment on index public.trades_social_performance_scope_idx is
  'Supports source-account-scoped social history and integrity calculations.';

comment on index public.social_copy_sources_one_published_per_trader_idx is
  'Enforces the initial social-profile contract: one selected published broker account per trader.';

create or replace function public.social_source_performance_eligibility(p_source_id uuid)
returns table (eligible boolean, reason text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select
      s.id,
      s.status,
      s.trader_user_id,
      s.broker_account_id,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      lower(coalesce(b.linked_account_type, '')) as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    join public.broker_accounts b
      on b.id = s.broker_account_id
     and b.user_id = s.trader_user_id
    where s.id = p_source_id
  ), scoped as (
    select distinct on (
      t.broker_account_id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text)
    )
      t.id,
      t.broker_account_id,
      t.metaapi_order_id,
      t.status,
      t.opened_at,
      t.closed_at,
      t.profit,
      t.created_at
    from public.trades t
    join source_context sc on sc.broker_account_id = t.broker_account_id
    where (lower(t.status) = 'open'
       or t.closed_at is not null
       or lower(t.status) = 'closed')
    and not exists (
      select 1
      from public.social_copy_subscriptions sub
      join public.social_copy_trade_mappings map on map.subscription_id = sub.id
      where sub.destination_broker_account_id = t.broker_account_id
        and map.destination_ticket is not null
        and map.destination_ticket = t.metaapi_order_id
    )
    order by
      t.broker_account_id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text),
      t.created_at desc,
      t.id desc
  ), facts as (
    select
      count(*) filter (where lower(status) = 'closed' or closed_at is not null) as closed_count,
      count(*) filter (
        where (lower(status) = 'closed' or closed_at is not null)
          and (profit is null or metaapi_order_id is null or btrim(metaapi_order_id) = '')
      ) as incomplete_count,
      min(opened_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_start,
      max(closed_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_end
    from scoped
  )
  select
    case
      when sc.id is null then false
      when sc.status <> 'published' then false
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then false
      when sc.account_mode <> 'demo' then false
      when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then false
      when sc.last_synced_at is null then false
      when sc.last_synced_at < now() - interval '15 minutes' then false
      when coalesce(f.incomplete_count, 0) > 0 then false
      when coalesce(f.closed_count, 0) < 10 then false
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then false
      else true
    end,
    case
      when sc.id is null then 'source_missing'
      when sc.status <> 'published' then 'source_not_published'
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
      when sc.account_mode = '' then 'account_mode_unknown'
      when sc.account_mode <> 'demo' then 'demo_only'
      when not sc.is_active then 'source_inactive'
      when sc.connection_status = 'error' then 'sync_failed'
      when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
      when sc.last_synced_at is null then 'sync_pending'
      when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
      when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
      when coalesce(f.closed_count, 0) < 10 then 'minimum_trades_not_met'
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then 'minimum_period_not_met'
      else 'eligible'
    end
  from (select 1) seed
  left join source_context sc on true
  left join facts f on true;
$$;

comment on function public.social_source_performance_eligibility(uuid) is
  'Server-side copy eligibility: published owned demo MT source, healthy/fresh sync, complete scoped history, >=10 closed trades spanning >=7 days.';

revoke all on function public.social_source_performance_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_performance_eligibility(uuid)
  to service_role;

-- Re-evaluate eligibility on every worker reconciliation. A source that later
-- becomes stale, incomplete, disconnected, unsupported or unpublished cannot
-- continue opening new copies merely because its subscription predates this
-- migration.
create or replace function public.check_social_copy_subscription_authorization(p_subscription_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when current_user in ('service_role', 'postgres') then exists (
    select 1
    from public.social_copy_subscriptions s
    join public.social_copy_sources src on src.id = s.source_id
    join public.social_profiles sp on sp.user_id = src.trader_user_id
    join public.broker_accounts source_account on source_account.id = src.broker_account_id
    join public.broker_accounts destination_account on destination_account.id = s.destination_broker_account_id
    cross join lateral public.social_source_performance_eligibility(src.id) eligibility
    where s.id = p_subscription_id
      and eligibility.eligible = true
      and src.status = 'published' and sp.is_listed = true
      and source_account.user_id = src.trader_user_id
      and destination_account.user_id = s.subscriber_user_id
      and destination_account.is_active = true
      and lower(coalesce(destination_account.connection_status, '')) in ('connected', 'healthy')
      and lower(coalesce(destination_account.linked_account_type, '')) in ('demo', 'practice')
      and (
        sp.access_mode = 'open'
        or exists (select 1 from public.social_follow_relationships r
          where r.follower_user_id = s.subscriber_user_id
            and r.followed_user_id = src.trader_user_id
            and r.status = 'accepted')
      )
  ) else false end;
$$;

revoke all on function public.check_social_copy_subscription_authorization(uuid)
  from public, anon, authenticated;
grant execute on function public.check_social_copy_subscription_authorization(uuid)
  to service_role;

create or replace function public.get_social_provider_performance(p_trader_user_id uuid)
returns table (
  source_id uuid,
  source_label text,
  source_status text,
  performance_status text,
  status_reason text,
  account_mode text,
  currency text,
  period_started_at timestamptz,
  period_ended_at timestamptz,
  last_sync_succeeded_at timestamptz,
  calculated_at timestamptz,
  history_complete boolean,
  open_trade_count bigint,
  closed_trade_count bigint,
  realized_profit numeric,
  win_rate numeric,
  profit_factor numeric,
  return_percentage numeric,
  maximum_drawdown numeric,
  equity_curve_available boolean,
  is_copy_eligible boolean,
  eligibility_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.social_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_profile
  from public.social_profiles
  where user_id = p_trader_user_id and is_listed = true;
  if not found then
    raise exception 'Social profile is not available' using errcode = 'P0002';
  end if;

  if v_actor <> p_trader_user_id and not (
    v_profile.share_trade_history
    and (
      v_profile.access_mode = 'open'
      or exists (
        select 1 from public.social_follow_relationships r
        where r.follower_user_id = v_actor
          and r.followed_user_id = p_trader_user_id
          and r.status = 'accepted'
      )
    )
  ) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;

  return query
  with source_context as (
    select
      s.id,
      coalesce(nullif(btrim(s.label), ''), 'Copy source') as label,
      s.status,
      s.broker_account_id,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      lower(coalesce(b.linked_account_type, '')) as normalized_account_mode,
      b.last_currency,
      b.last_synced_at
    from public.social_copy_sources s
    left join public.broker_accounts b
      on b.id = s.broker_account_id
     and b.user_id = s.trader_user_id
    where s.trader_user_id = p_trader_user_id
      and (s.status = 'published' or v_actor = p_trader_user_id)
  ), scoped as (
    select distinct on (
      sc.id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text)
    )
      sc.id as source_id,
      t.id,
      t.metaapi_order_id,
      lower(t.status) as status,
      t.opened_at,
      t.closed_at,
      t.profit,
      t.created_at
    from source_context sc
    join public.trades t on t.broker_account_id = sc.broker_account_id
    where (lower(t.status) = 'open' or t.closed_at is not null or lower(t.status) = 'closed')
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings map on map.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and map.destination_ticket is not null
          and map.destination_ticket = t.metaapi_order_id
      )
    order by sc.id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text),
      t.created_at desc,
      t.id desc
  ), facts as (
    select
      sc.id as source_id,
      count(s.id) filter (where s.status = 'open' and s.closed_at is null) as open_count,
      count(s.id) filter (where s.status = 'closed' or s.closed_at is not null) as closed_count,
      count(s.id) filter (
        where (s.status = 'closed' or s.closed_at is not null)
          and (s.profit is null or s.metaapi_order_id is null or btrim(s.metaapi_order_id) = '')
      ) as incomplete_count,
      min(s.opened_at) filter (where s.status = 'closed' or s.closed_at is not null) as period_start,
      max(s.closed_at) filter (where s.status = 'closed' or s.closed_at is not null) as period_end,
      sum(s.profit) filter (where s.status = 'closed' or s.closed_at is not null) as pnl,
      count(s.id) filter (
        where (s.status = 'closed' or s.closed_at is not null) and s.profit > 0
      ) as wins,
      sum(s.profit) filter (
        where (s.status = 'closed' or s.closed_at is not null) and s.profit > 0
      ) as gross_profit,
      abs(sum(s.profit) filter (
        where (s.status = 'closed' or s.closed_at is not null) and s.profit < 0
      )) as gross_loss
    from source_context sc
    left join scoped s on s.source_id = sc.id
    group by sc.id
  ), evaluated as (
    select sc.*, f.*,
      case
        when sc.broker_account_id is null then 'unavailable'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'unavailable'
        when sc.connection_status = 'error' then 'failed'
        when sc.last_synced_at is null then 'pending'
        when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then 'unavailable'
        when sc.last_synced_at < now() - interval '15 minutes' then 'stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'available'
      end as performance_state,
      case
        when sc.broker_account_id is null then 'source_account_missing'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
        when sc.connection_status = 'error' then 'sync_failed'
        when sc.last_synced_at is null then 'sync_pending'
        when not sc.is_active then 'source_inactive'
        when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
        when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'current'
      end as performance_reason
    from source_context sc
    join facts f on f.source_id = sc.id
  )
  select
    e.id,
    e.label,
    e.status,
    e.performance_state,
    e.performance_reason,
    case when e.normalized_account_mode in ('demo', 'practice') then 'demo'
         when e.normalized_account_mode = '' then 'unknown' else 'live' end,
    nullif(btrim(e.last_currency), ''),
    e.period_start,
    e.period_end,
    e.last_synced_at,
    statement_timestamp(),
    e.performance_state in ('available', 'stale'),
    e.open_count,
    e.closed_count,
    case when e.performance_state in ('available', 'stale') then coalesce(e.pnl, 0) else null end,
    case when e.performance_state in ('available', 'stale') and e.closed_count > 0
      then round((e.wins::numeric / e.closed_count::numeric) * 100, 2) else null end,
    case when e.performance_state in ('available', 'stale') and coalesce(e.gross_loss, 0) > 0
      then round(coalesce(e.gross_profit, 0) / e.gross_loss, 4) else null end,
    null::numeric,
    null::numeric,
    false,
    eligibility.eligible,
    eligibility.reason
  from evaluated e
  cross join lateral public.social_source_performance_eligibility(e.id) eligibility
  order by (e.status = 'published') desc, e.label, e.id;
end;
$$;

revoke all on function public.get_social_provider_performance(uuid)
  from public, anon;
grant execute on function public.get_social_provider_performance(uuid)
  to authenticated;

create or replace function public.get_social_source_trade_history(
  p_source_id uuid,
  p_limit integer default 100
)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.social_copy_sources%rowtype;
  v_access record;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_source from public.social_copy_sources where id = p_source_id;
  if not found then raise exception 'Published source is not available' using errcode = 'P0002'; end if;

  select * into v_access
  from public.get_social_trade_history_access(v_source.trader_user_id);
  if not coalesce(v_access.can_view, false) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;
  if v_actor <> v_source.trader_user_id and v_source.status <> 'published' then
    raise exception 'Published source is not available' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = v_source.broker_account_id and b.user_id = v_source.trader_user_id
  ) then
    raise exception 'Source account is unavailable' using errcode = 'P0002';
  end if;

  return query
  with scoped as (
    select distinct on (coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text))
      t.*
    from public.trades t
    where t.broker_account_id = v_source.broker_account_id
      and (lower(t.status) = 'open' or t.closed_at is not null or lower(t.status) = 'closed')
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings map on map.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and map.destination_ticket is not null
          and map.destination_ticket = t.metaapi_order_id
      )
    order by coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text), t.created_at desc, t.id desc
  )
  select s.id, s.symbol, lower(s.direction),
    case when s.closed_at is not null or lower(s.status) = 'closed' then 'closed' else 'open' end,
    s.opened_at, s.closed_at,
    case when s.closed_at is not null or lower(s.status) = 'closed' then s.profit else null end
  from scoped s
  order by coalesce(s.closed_at, s.opened_at) desc, s.id
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.get_social_source_trade_history(uuid, integer)
  from public, anon;
grant execute on function public.get_social_source_trade_history(uuid, integer)
  to authenticated;

-- Backward compatibility for clients that have not learned source selection.
-- A single published source is safe; zero sources returns no history; multiple
-- sources fail explicitly instead of silently mixing or choosing an account.
create or replace function public.get_social_trade_history(p_trader_user_id uuid, p_limit integer default 100)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source_id uuid;
  v_source_count integer;
begin
  select count(*)::integer
    into v_source_count
  from public.social_copy_sources s
  where s.trader_user_id = p_trader_user_id and s.status = 'published';

  if v_source_count = 0 then return; end if;
  if v_source_count > 1 then
    raise exception 'Select a published source account' using errcode = '22023';
  end if;
  select s.id into v_source_id
  from public.social_copy_sources s
  where s.trader_user_id = p_trader_user_id and s.status = 'published';

  return query select * from public.get_social_source_trade_history(v_source_id, p_limit);
end;
$$;

revoke all on function public.get_social_trade_history(uuid, integer)
  from public, anon;
grant execute on function public.get_social_trade_history(uuid, integer)
  to authenticated;

-- Copy eligibility is enforced at the mutation boundary. Publication remains
-- possible while synchronization/history is pending, but copying cannot start.
create or replace function public.create_social_copy_subscription(
  p_source_id uuid,
  p_destination_broker_account_id uuid,
  p_sizing_mode text,
  p_fixed_lot numeric,
  p_lot_multiplier numeric,
  p_max_lot numeric,
  p_max_daily_loss numeric default null,
  p_requested_account_mode text default 'demo',
  p_symbol_map jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor uuid := auth.uid();
  v_source public.social_copy_sources%rowtype;
  v_access text;
  v_id uuid;
  v_eligible boolean;
  v_eligibility_reason text;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before copying a trader' using errcode = '55000';
  end if;
  select s.* into v_source
  from public.social_copy_sources s join public.social_profiles sp on sp.user_id = s.trader_user_id
  where s.id = p_source_id and s.status = 'published' and sp.is_listed = true;
  if not found then raise exception 'Social copy source is unavailable' using errcode = 'P0002'; end if;
  select sp.access_mode into v_access from public.social_profiles sp where sp.user_id = v_source.trader_user_id;
  if v_source.trader_user_id = v_actor then raise exception 'Users cannot copy themselves' using errcode = '23514'; end if;
  if v_access = 'private' and not exists (
    select 1 from public.social_follow_relationships r
    where r.follower_user_id = v_actor and r.followed_user_id = v_source.trader_user_id and r.status = 'accepted'
  ) then raise exception 'An accepted follow is required for this private trader' using errcode = '42501'; end if;
  if not exists (select 1 from public.broker_accounts b
    where b.id = p_destination_broker_account_id and b.user_id = v_actor) then
    raise exception 'Destination broker account is not owned by the current user' using errcode = '42501';
  end if;
  if not exists (select 1 from public.broker_accounts b
    where b.id = p_destination_broker_account_id
      and b.user_id = v_actor
      and b.is_active = true
      and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')
      and lower(coalesce(b.linked_account_type, '')) in ('demo', 'practice')) then
    raise exception 'Destination account must be a connected demo account' using errcode = '55000';
  end if;
  if p_sizing_mode not in ('fixed_lot', 'lot_multiplier', 'equity_ratio')
    or p_requested_account_mode not in ('demo', 'live') or coalesce(p_lot_multiplier, 0) <= 0
    or coalesce(p_max_lot, 0) <= 0 or (p_sizing_mode = 'fixed_lot' and coalesce(p_fixed_lot, 0) <= 0)
    or jsonb_typeof(coalesce(p_symbol_map, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid social copy risk settings' using errcode = '22023';
  end if;

  select e.eligible, e.reason into v_eligible, v_eligibility_reason
  from public.social_source_performance_eligibility(p_source_id) e;
  if not coalesce(v_eligible, false) then
    raise exception 'Provider is not eligible for copying: %', coalesce(v_eligibility_reason, 'unknown')
      using errcode = '55000';
  end if;
  if p_requested_account_mode <> 'demo' then
    raise exception 'Social copy eligibility is demo-only' using errcode = '55000';
  end if;

  insert into public.social_copy_subscriptions (
    source_id, source_trader_user_id, subscriber_user_id, destination_broker_account_id,
    sizing_mode, fixed_lot, lot_multiplier, max_lot, max_daily_loss,
    requested_account_mode, symbol_map
  ) values (
    p_source_id, v_source.trader_user_id, v_actor, p_destination_broker_account_id,
    p_sizing_mode, case when p_sizing_mode = 'fixed_lot' then p_fixed_lot else null end,
    p_lot_multiplier, p_max_lot, p_max_daily_loss, p_requested_account_mode, coalesce(p_symbol_map, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A current subscription already exists for this source and destination' using errcode = '23505';
end;
$$;

revoke all on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

-- Extend source discovery without exposing broker_account_id or credentials.
drop function public.get_social_copy_sources(uuid);
create function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (
  source_id uuid,
  trader_user_id uuid,
  label text,
  provider text,
  platform text,
  account_mode text,
  connection_healthy boolean,
  is_copy_eligible boolean,
  eligibility_reason text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.trader_user_id, coalesce(s.label, 'Copy source'),
    coalesce(b.provider, 'fxsocket'), b.platform,
    case when lower(coalesce(b.linked_account_type, '')) in ('demo', 'practice') then 'demo'
         when coalesce(b.linked_account_type, '') = '' then 'unknown' else 'live' end,
    (b.is_active = true and b.connection_status in ('connected', 'healthy')),
    eligibility.eligible,
    eligibility.reason
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (
      sp.access_mode = 'open'
      or s.trader_user_id = auth.uid()
      or exists (select 1 from public.social_follow_relationships r
        where r.follower_user_id = auth.uid() and r.followed_user_id = s.trader_user_id and r.status = 'accepted')
    );
$$;

revoke all on function public.get_social_copy_sources(uuid) from public, anon;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;

-- Selecting a different source account is an explicit replacement, not an
-- additional published account. Existing subscriptions to the previous source
-- are paused and still pass through the normal worker acknowledgement path.
create or replace function public.publish_social_copy_source(
  p_broker_account_id uuid,
  p_label text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social copy source publishing requires a verified account' using errcode = '42501';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before publishing a copy source' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = p_broker_account_id and b.user_id = v_actor
  ) then
    raise exception 'Broker account is not owned by the current user' using errcode = '42501';
  end if;

  update public.social_copy_subscriptions subscription
  set desired_status = 'paused', updated_at = now()
  from public.social_copy_sources source
  where source.id = subscription.source_id
    and source.trader_user_id = v_actor
    and source.broker_account_id <> p_broker_account_id
    and source.status = 'published'
    and subscription.status in ('pending', 'active');

  update public.social_copy_sources
  set status = 'paused', updated_at = now()
  where trader_user_id = v_actor
    and broker_account_id <> p_broker_account_id
    and status = 'published';

  insert into public.social_copy_sources (trader_user_id, broker_account_id, status, label)
  values (v_actor, p_broker_account_id, 'published', nullif(btrim(p_label), ''))
  on conflict (broker_account_id) do update set
    status = 'published', label = excluded.label, updated_at = now()
  where public.social_copy_sources.trader_user_id = v_actor
  returning id into v_id;
  if v_id is null then raise exception 'Copy source belongs to another trader' using errcode = '42501'; end if;
  return v_id;
end;
$$;

-- Paused sources can also be reselected through the existing status RPC. Keep
-- that path consistent with publish_social_copy_source so the partial unique
-- index never becomes the user-facing mechanism for resolving two selections.
create or replace function public.set_social_copy_source_status(p_source_id uuid, p_status text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_status not in ('published', 'paused', 'retired') then
    raise exception 'Invalid copy source status' using errcode = '22023';
  end if;

  if p_status = 'published' then
    update public.social_copy_subscriptions subscription
    set desired_status = 'paused', updated_at = now()
    from public.social_copy_sources source
    where source.id = subscription.source_id
      and source.trader_user_id = v_actor
      and source.id <> p_source_id
      and source.status = 'published'
      and subscription.status in ('pending', 'active');

    update public.social_copy_sources
    set status = 'paused', updated_at = now()
    where trader_user_id = v_actor
      and id <> p_source_id
      and status = 'published';
  end if;

  update public.social_copy_sources
  set status = p_status, updated_at = now()
  where id = p_source_id and trader_user_id = v_actor;
  if not found then raise exception 'Copy source was not found' using errcode = 'P0002'; end if;

  if p_status <> 'published' then
    update public.social_copy_subscriptions
    set desired_status = 'paused', updated_at = now()
    where source_id = p_source_id and status in ('pending', 'active');
  end if;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261019121000', '20261019121000_social_provider_performance_foundation', ARRAY['-- 20261019121000_social_provider_performance_foundation']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261020100000_matchtrader_broker_accounts.sql ==========
-- MatchTrader accounts. Each trader links their own Match-Trader login (platform URL, email, password).
-- Match-Trader is white-label, so every broker hosts its own platform URL; it is validated as public
-- https before any request. The password stays service-role only.
--
-- Match-Trader writes carry no client order id or comment, so the worker keeps the signal comment of
-- each order it opens in matchtrader_order_tags (service-role only) and re-attaches it when reading.

alter table public.broker_accounts
  drop constraint if exists broker_accounts_provider_check;

alter table public.broker_accounts
  add constraint broker_accounts_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker', 'matchtrader'));

comment on column public.broker_accounts.provider is
  'Broker provider: fxsocket (default), mtapi, ctrader, binance, bybit, kucoin, dxtrade, tradelocker, or matchtrader. Controls which BrokerProvider implementation handles this account.';

alter table public.broker_accounts
  add column if not exists matchtrader_account_id text,
  add column if not exists matchtrader_server_url text,
  add column if not exists matchtrader_broker_id text,
  add column if not exists matchtrader_email text,
  add column if not exists matchtrader_password_encrypted text,
  add column if not exists matchtrader_trading_account_uuid text,
  add column if not exists matchtrader_system_uuid text,
  add column if not exists matchtrader_status text;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_matchtrader_status_check;
alter table public.broker_accounts
  add constraint broker_accounts_matchtrader_status_check
    check (matchtrader_status is null or matchtrader_status in ('connecting', 'connected', 'error', 'disconnected'));

comment on column public.broker_accounts.matchtrader_account_id is
  'Stable id for the linked Match-Trader account (fingerprint of platform host, broker id, email and trading account). Safe to show in the broker list.';
comment on column public.broker_accounts.matchtrader_server_url is
  'Validated https platform URL of the broker Match-Trader server (for example https://mtr-demo-prod.match-trader.com).';
comment on column public.broker_accounts.matchtrader_broker_id is
  'Match-Trader brokerId / partnerId sent on login.';
comment on column public.broker_accounts.matchtrader_email is
  'Match-Trader login email.';
comment on column public.broker_accounts.matchtrader_password_encrypted is
  'AES-256-GCM Match-Trader password. Service-role only.';
comment on column public.broker_accounts.matchtrader_trading_account_uuid is
  'Match-Trader trading account uuid selected at link time.';
comment on column public.broker_accounts.matchtrader_system_uuid is
  'Match-Trader system uuid (the SYSTEM_UUID path segment of /mtr-api/{systemUuid}/...).';
comment on column public.broker_accounts.matchtrader_status is
  'Match-Trader link status shown in the Connection column.';

create unique index if not exists broker_accounts_matchtrader_account_id_idx
  on public.broker_accounts (user_id, matchtrader_account_id)
  where matchtrader_account_id is not null and btrim(matchtrader_account_id) <> '';

grant select (
  matchtrader_account_id,
  matchtrader_server_url,
  matchtrader_broker_id,
  matchtrader_email,
  matchtrader_trading_account_uuid,
  matchtrader_system_uuid,
  matchtrader_status
) on public.broker_accounts to authenticated;

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
    new.dxtrade_password_encrypted := null;
    new.dxtrade_account_id := null;
    new.dxtrade_server_url := null;
    new.dxtrade_username := null;
    new.dxtrade_domain := null;
    new.dxtrade_account_code := null;
    new.dxtrade_is_position_based := null;
    new.tradelocker_password_encrypted := null;
    new.tradelocker_account_id := null;
    new.tradelocker_environment := null;
    new.tradelocker_server := null;
    new.tradelocker_email := null;
    new.tradelocker_account_ref := null;
    new.tradelocker_acc_num := null;
    new.matchtrader_password_encrypted := null;
    new.matchtrader_account_id := null;
    new.matchtrader_server_url := null;
    new.matchtrader_broker_id := null;
    new.matchtrader_email := null;
    new.matchtrader_trading_account_uuid := null;
    new.matchtrader_system_uuid := null;
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
    new.dxtrade_password_encrypted := old.dxtrade_password_encrypted;
    new.dxtrade_account_id := old.dxtrade_account_id;
    new.dxtrade_server_url := old.dxtrade_server_url;
    new.dxtrade_username := old.dxtrade_username;
    new.dxtrade_domain := old.dxtrade_domain;
    new.dxtrade_account_code := old.dxtrade_account_code;
    new.dxtrade_is_position_based := old.dxtrade_is_position_based;
    new.tradelocker_password_encrypted := old.tradelocker_password_encrypted;
    new.tradelocker_account_id := old.tradelocker_account_id;
    new.tradelocker_environment := old.tradelocker_environment;
    new.tradelocker_server := old.tradelocker_server;
    new.tradelocker_email := old.tradelocker_email;
    new.tradelocker_account_ref := old.tradelocker_account_ref;
    new.tradelocker_acc_num := old.tradelocker_acc_num;
    new.matchtrader_password_encrypted := old.matchtrader_password_encrypted;
    new.matchtrader_account_id := old.matchtrader_account_id;
    new.matchtrader_server_url := old.matchtrader_server_url;
    new.matchtrader_broker_id := old.matchtrader_broker_id;
    new.matchtrader_email := old.matchtrader_email;
    new.matchtrader_trading_account_uuid := old.matchtrader_trading_account_uuid;
    new.matchtrader_system_uuid := old.matchtrader_system_uuid;
  end if;
  return new;
end;
$$;

-- Write lease: let the copy worker fence Match-Trader accounts.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'broker_write_leases'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%provider%';
  if constraint_name is not null then
    execute format('alter table public.broker_write_leases drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.broker_write_leases
  drop constraint if exists broker_write_leases_provider_check;

alter table public.broker_write_leases
  add constraint broker_write_leases_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker', 'matchtrader'));

create or replace function public.acquire_broker_write_lease(
  p_broker_account_id uuid,
  p_expected_provider text,
  p_expected_session_id text,
  p_expected_writer_epoch bigint,
  p_operation text,
  p_ttl_seconds integer default 120
)
returns table(lease_id uuid, writer_epoch bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.broker_accounts%rowtype;
  authoritative_session text;
  new_lease_id uuid;
begin
  if p_expected_provider not in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker', 'matchtrader')
    or nullif(btrim(coalesce(p_expected_session_id, '')), '') is null
    or p_expected_writer_epoch is null
    or nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  select * into account_row
  from public.broker_accounts
  where id = p_broker_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  authoritative_session := case account_row.provider
    when 'mtapi' then nullif(btrim(account_row.mtapi_session_id), '')
    when 'ctrader' then nullif(btrim(account_row.ctrader_account_id), '')
    when 'binance' then nullif(btrim(account_row.binance_account_id), '')
    when 'bybit' then nullif(btrim(account_row.bybit_account_id), '')
    when 'kucoin' then nullif(btrim(account_row.kucoin_account_id), '')
    when 'dxtrade' then nullif(btrim(account_row.dxtrade_account_id), '')
    when 'tradelocker' then nullif(btrim(account_row.tradelocker_account_id), '')
    when 'matchtrader' then nullif(btrim(account_row.matchtrader_account_id), '')
    else coalesce(
      nullif(btrim(account_row.fxsocket_account_id), ''),
      nullif(btrim(account_row.metaapi_account_id), '')
    )
  end;

  if account_row.provider_transition_state <> 'stable'
    or account_row.provider <> p_expected_provider
    or account_row.writer_epoch <> p_expected_writer_epoch
    or authoritative_session is distinct from btrim(p_expected_session_id) then
    raise exception using errcode = 'P0001', message = 'BROKER_WRITE_FENCE_REJECTED';
  end if;

  delete from public.broker_write_leases
  where broker_account_id = p_broker_account_id and expires_at <= clock_timestamp();

  insert into public.broker_write_leases (
    broker_account_id, writer_epoch, provider, operation, expires_at
  ) values (
    p_broker_account_id,
    account_row.writer_epoch,
    account_row.provider,
    left(btrim(p_operation), 80),
    clock_timestamp() + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
  ) returning id into new_lease_id;

  return query select new_lease_id, account_row.writer_epoch;
end;
$$;

-- Signal comment of each order the worker opened on a Match-Trader account (the API has no comment field).
create table if not exists public.matchtrader_order_tags (
  broker_account_id uuid not null references public.broker_accounts(id) on delete cascade,
  order_id text not null,
  comment text not null,
  symbol text,
  side text,
  created_at timestamptz not null default now(),
  primary key (broker_account_id, order_id)
);

create index if not exists matchtrader_order_tags_created_idx
  on public.matchtrader_order_tags (broker_account_id, created_at desc);

alter table public.matchtrader_order_tags enable row level security;
revoke all on public.matchtrader_order_tags from anon, authenticated;
grant select, insert, update, delete on public.matchtrader_order_tags to service_role;

comment on table public.matchtrader_order_tags is
  'Signal comment per Match-Trader order id. Service-role only; Match-Trader writes have no comment field.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261020100000', '20261020100000_matchtrader_broker_accounts', ARRAY['-- 20261020100000_matchtrader_broker_accounts']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261020120000_marketing_promo_banner.sql ==========
/*
  # marketing_promo_banner — promo banner above the marketing nav

  One row per campaign. Marketing visitors are anonymous, so `anon` may read a row, but only while it is
  enabled and inside its schedule window. Nothing is writable by clients: use the Supabase dashboard or
  the service role to create, edit or disable a campaign.

  Example (disabled until you flip `enabled`):

    insert into public.marketing_promo_banner
      (enabled, headline, coupon_code, cta_label, cta_href, media_url, ends_at)
    values
      (true, 'Halloween Special: 55% OFF', 'SPOOKY55', 'Get Code', '/pricing',
       'https://<project>.supabase.co/storage/v1/object/public/marketing-assets/halloween.mp4',
       now() + interval '3 days');

  Media: upload to the public `marketing-assets` bucket (service role / dashboard only). Use a wide
  image (about 1440 x 76), a GIF, or mp4/webm. `.mov` only plays reliably in Safari.
*/

create table if not exists public.marketing_promo_banner (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  headline text,
  coupon_code text,
  cta_label text,
  -- A site path (/pricing) or an absolute https:// URL.
  cta_href text,
  media_url text,
  media_url_mobile text,
  starts_at timestamptz,
  -- Drives the countdown. After this moment the banner is no longer served.
  ends_at timestamptz,
  dismissible boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint marketing_promo_banner_window_check
    check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint marketing_promo_banner_headline_len check (headline is null or char_length(headline) <= 200),
  constraint marketing_promo_banner_coupon_len check (coupon_code is null or char_length(coupon_code) <= 40),
  constraint marketing_promo_banner_cta_label_len check (cta_label is null or char_length(cta_label) <= 40),
  constraint marketing_promo_banner_cta_href_shape
    check (cta_href is null or cta_href ~ '^(/[^/\\]|/$|https://)'),
  constraint marketing_promo_banner_media_shape
    check (media_url is null or media_url ~ '^(https://|/)'),
  constraint marketing_promo_banner_media_mobile_shape
    check (media_url_mobile is null or media_url_mobile ~ '^(https://|/)')
);

alter table public.marketing_promo_banner enable row level security;

drop policy if exists "Anyone can read the live promo banner" on public.marketing_promo_banner;
create policy "Anyone can read the live promo banner"
  on public.marketing_promo_banner for select
  to anon, authenticated
  using (
    enabled
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

revoke all on public.marketing_promo_banner from anon, authenticated;
grant select on public.marketing_promo_banner to anon, authenticated;
grant all on public.marketing_promo_banner to service_role;

comment on table public.marketing_promo_banner is
  'Promo banner shown above the marketing nav. Readable by anyone while enabled and inside starts_at..ends_at; written only by the service role.';

-- Public brand/campaign media. Objects are world-readable; uploads are service-role only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-assets',
  'marketing-assets',
  true,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Marketing assets public read" on storage.objects;
create policy "Marketing assets public read"
  on storage.objects for select
  to public
  using (bucket_id = 'marketing-assets');

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261020120000', '20261020120000_marketing_promo_banner', ARRAY['-- 20261020120000_marketing_promo_banner']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261020140000_mirror_guard_delete_open_copies.sql ==========
-- ---------------------------------------------------------------------------
-- Mirror copy: refuse to delete a copy link while copied trades are still open.
--
-- Removing a link hard-deletes its ledger through the cascade. If copied trades
-- on the slave are still open at the broker, that would erase the only record of
-- them and leave live positions unmanaged. The dashboard now stops a link first
-- (the worker flattens the copies, then the delete succeeds); this trigger
-- protects every other path -- drag-to-disconnect on the Configurations page,
-- account-removal cascades, scripts -- from doing the damage.
--
-- The MIRROR_OPEN_COPIES marker lets the frontend recognise the refusal and show
-- a clean message (and run the stop-then-retry flow) instead of the raw text.
--
-- 'closing' is included for completeness even though the worker never writes it
-- today (its closeAll only sweeps opening/open/uncertain/error); blocking on it
-- is fail-safe should a future code path use that state.
-- ---------------------------------------------------------------------------
create or replace function public.mirror_copy_block_delete_with_open_copies()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  open_count integer;
begin
  select count(*) into open_count
  from public.mirror_copy_trade_mappings
  where link_id = new.id
    and state in ('opening', 'open', 'closing', 'uncertain', 'error');
  if open_count > 0 then
    raise exception 'MIRROR_OPEN_COPIES: Remove blocked: % copied trade(s) are still open on the slave account. Stop copying on the Mirror Account page first (that closes them), then remove the link.', open_count
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.mirror_copy_block_delete_with_open_copies() from public, anon, authenticated;

drop trigger if exists mirror_copy_block_delete_with_open_copies on public.broker_copy_links;
create trigger mirror_copy_block_delete_with_open_copies
  before delete on public.broker_copy_links
  for each row execute function public.mirror_copy_block_delete_with_open_copies();

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261020140000', '20261020140000_mirror_guard_delete_open_copies', ARRAY['-- 20261020140000_mirror_guard_delete_open_copies']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261021120000_invoice_payments_copier_pause_reason.sql ==========
/*
  Billing transparency groundwork (admin dashboard feedback, 2026-10-21):

  1. invoice_payments — our own payment history table, one row per paid Stripe
     invoice. Written by the stripe-webhook edge function on every invoice.paid
     (going forward) and backfilled from Stripe by the billing-backfill edge
     function (historical invoices + refund state from the invoice's charge).
     RLS is enabled with no policies: deny-by-default for anon/authenticated.
     The admin dashboard reads it through an admin-only policy added in the
     tscopier-admin migrations. The service role (webhook / backfill) bypasses RLS.

  2. user_profiles.copier_pause_reason — records WHY the copier was paused so the
     admin dashboard can break paused users down by cause (user action, trial
     expiry, payment failure, subscription end). Written by every code path that
     sets copier_paused; cleared when the copier is resumed. Existing paused rows
     are backfilled by inference (subscriptions status) via billing-backfill.

  3. subscriptions.canceled_at — real cancellation date from Stripe, so the admin
     dashboard can group cancellations by month. Kept in sync by every code path
     that upserts the subscriptions row from Stripe; null while active.
*/

-- ---------------------------------------------------------------------------
-- 1. invoice_payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_invoice_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  amount_paid_cents integer NOT NULL,
  amount_refunded_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'partial_refund', 'refunded')),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_payments IS
  'One row per paid Stripe invoice (payment history). Written by stripe-webhook and billing-backfill.';

CREATE INDEX IF NOT EXISTS invoice_payments_user_id_idx
  ON public.invoice_payments (user_id);
CREATE INDEX IF NOT EXISTS invoice_payments_stripe_subscription_id_idx
  ON public.invoice_payments (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS invoice_payments_paid_at_idx
  ON public.invoice_payments (paid_at DESC NULLS LAST);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon/authenticated reads are denied. The service role
-- (webhook, backfill) bypasses RLS. Admin read policy lives in tscopier-admin migrations.

-- ---------------------------------------------------------------------------
-- 2. user_profiles.copier_pause_reason
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS copier_pause_reason text;

DO $$
BEGIN
  ALTER TABLE public.user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_copier_pause_reason_check;
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_copier_pause_reason_check
    CHECK (
      copier_pause_reason IS NULL
      OR copier_pause_reason IN (
        'user_paused',        -- user paused from the app / assistant
        'trial_expired',      -- 5-day Advanced trial ended
        'payment_failed',     -- invoice payment failed / subscription past_due
        'subscription_ended', -- subscription canceled or expired in Stripe
        'admin',              -- paused by an admin action
        'unknown'             -- paused before this field existed / reason unclear
      )
    );
END $$;

COMMENT ON COLUMN public.user_profiles.copier_pause_reason IS
  'Why copier_paused is true (user_paused, trial_expired, payment_failed, subscription_ended, admin, unknown). Null while not paused.';

-- ---------------------------------------------------------------------------
-- 3. subscriptions.canceled_at
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz;

COMMENT ON COLUMN public.subscriptions.canceled_at IS
  'Cancellation timestamp from Stripe (subscriptions.canceled_at). Null while the subscription has not been canceled.';

CREATE INDEX IF NOT EXISTS subscriptions_canceled_at_idx
  ON public.subscriptions (canceled_at)
  WHERE canceled_at IS NOT NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261021120000', '20261021120000_invoice_payments_copier_pause_reason', ARRAY['-- 20261021120000_invoice_payments_copier_pause_reason']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261021121000_social_synthetic_demo_sources.sql ==========
-- Explicitly distinguish preview-only synthetic sources from genuine broker
-- connections. Synthetic history remains visible, but it can never authorize
-- subscription creation or worker execution.

alter table public.social_copy_sources
  add column if not exists is_synthetic boolean not null default false;

comment on column public.social_copy_sources.is_synthetic is
  'True only for clearly labelled synthetic preview sources. Synthetic sources are never copy-eligible.';

create index if not exists social_copy_sources_synthetic_idx
  on public.social_copy_sources (trader_user_id, status)
  where is_synthetic = true;

create or replace function public.social_source_performance_eligibility(p_source_id uuid)
returns table (eligible boolean, reason text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select
      s.id,
      s.status,
      s.is_synthetic,
      s.trader_user_id,
      s.broker_account_id,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      lower(coalesce(b.linked_account_type, '')) as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    join public.broker_accounts b
      on b.id = s.broker_account_id
     and b.user_id = s.trader_user_id
    where s.id = p_source_id
  ), scoped as (
    select distinct on (
      t.broker_account_id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text)
    )
      t.id,
      t.broker_account_id,
      t.metaapi_order_id,
      t.status,
      t.opened_at,
      t.closed_at,
      t.profit,
      t.created_at
    from public.trades t
    join source_context sc on sc.broker_account_id = t.broker_account_id
    where (lower(t.status) = 'open'
       or t.closed_at is not null
       or lower(t.status) = 'closed')
    and not exists (
      select 1
      from public.social_copy_subscriptions sub
      join public.social_copy_trade_mappings map on map.subscription_id = sub.id
      where sub.destination_broker_account_id = t.broker_account_id
        and map.destination_ticket is not null
        and map.destination_ticket = t.metaapi_order_id
    )
    order by
      t.broker_account_id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text),
      t.created_at desc,
      t.id desc
  ), facts as (
    select
      count(*) filter (where lower(status) = 'closed' or closed_at is not null) as closed_count,
      count(*) filter (
        where (lower(status) = 'closed' or closed_at is not null)
          and (profit is null or metaapi_order_id is null or btrim(metaapi_order_id) = '')
      ) as incomplete_count,
      min(opened_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_start,
      max(closed_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_end
    from scoped
  )
  select
    case
      when sc.id is null then false
      when sc.is_synthetic then false
      when sc.status <> 'published' then false
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then false
      when sc.account_mode <> 'demo' then false
      when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then false
      when sc.last_synced_at is null then false
      when sc.last_synced_at < now() - interval '15 minutes' then false
      when coalesce(f.incomplete_count, 0) > 0 then false
      when coalesce(f.closed_count, 0) < 10 then false
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then false
      else true
    end,
    case
      when sc.id is null then 'source_missing'
      when sc.is_synthetic then 'synthetic_demo'
      when sc.status <> 'published' then 'source_not_published'
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
      when sc.account_mode = '' then 'account_mode_unknown'
      when sc.account_mode <> 'demo' then 'demo_only'
      when not sc.is_active then 'source_inactive'
      when sc.connection_status = 'error' then 'sync_failed'
      when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
      when sc.last_synced_at is null then 'sync_pending'
      when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
      when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
      when coalesce(f.closed_count, 0) < 10 then 'minimum_trades_not_met'
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then 'minimum_period_not_met'
      else 'eligible'
    end
  from (select 1) seed
  left join source_context sc on true
  left join facts f on true;
$$;

comment on function public.social_source_performance_eligibility(uuid) is
  'Server-side copy eligibility: rejects synthetic sources, then requires a published owned demo MT source, healthy/fresh sync, complete scoped history, >=10 closed trades spanning >=7 days.';

revoke all on function public.social_source_performance_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_performance_eligibility(uuid)
  to service_role;

create or replace function public.pause_synthetic_social_copy_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.is_synthetic then
    update public.social_copy_subscriptions
    set desired_status = 'paused', updated_at = now()
    where source_id = new.id
      and status in ('pending', 'active');
  end if;
  return new;
end;
$$;

revoke all on function public.pause_synthetic_social_copy_subscriptions()
  from public, anon, authenticated;

drop trigger if exists social_copy_sources_pause_synthetic_subscriptions
  on public.social_copy_sources;
create trigger social_copy_sources_pause_synthetic_subscriptions
  after insert or update of is_synthetic on public.social_copy_sources
  for each row execute function public.pause_synthetic_social_copy_subscriptions();

-- Immediately revoke worker authorization for any source marked synthetic,
-- including a source that had a subscription before it was marked.
update public.social_copy_subscriptions subscription
set desired_status = 'paused', updated_at = now()
from public.social_copy_sources source
where source.id = subscription.source_id
  and source.is_synthetic = true
  and subscription.status in ('pending', 'active');

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261021121000', '20261021121000_social_synthetic_demo_sources', ARRAY['-- 20261021121000_social_synthetic_demo_sources']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261021130000_social_profile_links_and_demo_guard.sql ==========
-- Persist public social profile links and make synthetic demo providers
-- impossible to copy at the database boundary.

create or replace function public.social_profile_links_are_valid(p_links jsonb)
returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(coalesce(p_links, '{}'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_each(coalesce(p_links, '{}'::jsonb)) entry
      where entry.key not in ('x', 'instagram', 'linkedin', 'youtube', 'tiktok', 'facebook')
        or jsonb_typeof(entry.value) <> 'string'
        or length(entry.value #>> '{}') > 500
        or not (
          (entry.key = 'x' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)/[^[:space:]]+$')
          or (entry.key = 'instagram' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*instagram\.com/[^[:space:]]+$')
          or (entry.key = 'linkedin' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*linkedin\.com/[^[:space:]]+$')
          or (entry.key = 'youtube' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/[^[:space:]]+$')
          or (entry.key = 'tiktok' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*tiktok\.com/[^[:space:]]+$')
          or (entry.key = 'facebook' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*facebook\.com/[^[:space:]]+$')
        )
    );
$$;

alter table public.user_profiles
  add column if not exists social_links jsonb not null default '{}'::jsonb;

alter table public.user_profiles
  drop constraint if exists user_profiles_social_links_valid;
alter table public.user_profiles
  add constraint user_profiles_social_links_valid
  check (public.social_profile_links_are_valid(social_links));

alter table public.social_profiles
  add column if not exists monthly_copy_price_cents integer,
  add column if not exists is_synthetic_demo boolean not null default false;

alter table public.social_profiles
  drop constraint if exists social_profiles_monthly_copy_price_valid;
alter table public.social_profiles
  add constraint social_profiles_monthly_copy_price_valid
  check (monthly_copy_price_cents is null or monthly_copy_price_cents between 0 and 10000000);

create or replace function public.set_social_profile_links(p_links jsonb)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_profile_links_are_valid(coalesce(p_links, '{}'::jsonb)) then
    raise exception 'Invalid social profile links' using errcode = '22023';
  end if;
  update public.user_profiles
  set social_links = coalesce(p_links, '{}'::jsonb), updated_at = now()
  where user_id = v_actor;
  if not found then raise exception 'User profile is unavailable' using errcode = 'P0002'; end if;
end;
$$;

drop function public.get_social_directory();
create function public.get_social_directory()
returns table (
  profile_user_id uuid, display_name text, username text, country text,
  access_mode text, is_self boolean, follower_count bigint, following_count bigint,
  viewer_relationship_status text, follows_viewer_status text, average_rating numeric,
  review_count bigint, viewer_rating smallint, shares_trade_history boolean,
  created_at timestamptz, monthly_copy_price_cents integer,
  is_synthetic_demo boolean, social_links jsonb
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select sp.user_id,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')),
    coalesce(nullif(btrim(up.username), ''), ''), coalesce(nullif(btrim(up.country), ''), ''),
    sp.access_mode, sp.user_id = v_actor,
    (select count(*) from public.social_follow_relationships incoming
      join public.social_profiles ip on ip.user_id = incoming.follower_user_id
      join public.user_profiles ii on ii.user_id = incoming.follower_user_id
      where incoming.followed_user_id = sp.user_id and incoming.status = 'accepted'
        and ip.is_listed = true
        and coalesce(nullif(btrim(ii.display_name), ''), nullif(btrim(ii.username), '')) is not null),
    (select count(*) from public.social_follow_relationships outgoing_count
      join public.social_profiles fp on fp.user_id = outgoing_count.followed_user_id
      join public.user_profiles fi on fi.user_id = outgoing_count.followed_user_id
      where outgoing_count.follower_user_id = sp.user_id and outgoing_count.status = 'accepted'
        and fp.is_listed = true
        and coalesce(nullif(btrim(fi.display_name), ''), nullif(btrim(fi.username), '')) is not null),
    outgoing.status, incoming_viewer.status,
    (select round(avg(r.rating)::numeric, 2) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select count(*) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select r.rating from public.social_trader_reviews r where r.trader_user_id = sp.user_id and r.reviewer_user_id = v_actor),
    sp.share_trade_history, sp.created_at, sp.monthly_copy_price_cents,
    sp.is_synthetic_demo, coalesce(up.social_links, '{}'::jsonb)
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join public.social_follow_relationships outgoing
    on outgoing.follower_user_id = v_actor and outgoing.followed_user_id = sp.user_id
  left join public.social_follow_relationships incoming_viewer
    on incoming_viewer.follower_user_id = sp.user_id and incoming_viewer.followed_user_id = v_actor
  where sp.is_listed = true
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  order by 7 desc, 2 asc, 1 asc;
end;
$$;

create or replace function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (
  source_id uuid, trader_user_id uuid, label text, provider text, platform text,
  account_mode text, connection_healthy boolean, is_copy_eligible boolean,
  eligibility_reason text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.trader_user_id, coalesce(s.label, 'Copy source'),
    coalesce(b.provider, 'fxsocket'), b.platform,
    case when lower(coalesce(b.linked_account_type, '')) in ('demo', 'practice') then 'demo'
         when coalesce(b.linked_account_type, '') = '' then 'unknown' else 'live' end,
    (b.is_active = true and b.connection_status in ('connected', 'healthy')),
    (eligibility.eligible and not sp.is_synthetic_demo),
    case when sp.is_synthetic_demo then 'synthetic_demo' else eligibility.reason end
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (sp.access_mode = 'open' or s.trader_user_id = auth.uid()
      or exists (select 1 from public.social_follow_relationships r
        where r.follower_user_id = auth.uid() and r.followed_user_id = s.trader_user_id and r.status = 'accepted'));
$$;

create or replace function public.reject_synthetic_social_copy_subscription()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (
    select 1 from public.social_copy_sources source
    join public.social_profiles profile on profile.user_id = source.trader_user_id
    where source.id = new.source_id and profile.is_synthetic_demo = true
  ) then
    raise exception 'Synthetic demo traders cannot be copied' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_synthetic_social_copy_subscription on public.social_copy_subscriptions;
create trigger reject_synthetic_social_copy_subscription
before insert or update of source_id on public.social_copy_subscriptions
for each row execute function public.reject_synthetic_social_copy_subscription();

revoke all on function public.social_profile_links_are_valid(jsonb) from public, anon, authenticated;
revoke all on function public.set_social_profile_links(jsonb) from public, anon;
revoke all on function public.reject_synthetic_social_copy_subscription() from public, anon, authenticated;
revoke all on function public.get_social_directory() from public, anon;
revoke all on function public.get_social_copy_sources(uuid) from public, anon;
grant execute on function public.set_social_profile_links(jsonb) to authenticated;
grant execute on function public.get_social_directory() to authenticated;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;

comment on column public.user_profiles.social_links is 'Validated public profile URLs only; never OAuth tokens or external account permissions.';
comment on column public.social_profiles.is_synthetic_demo is 'Authoritative server-side block for copy subscriptions targeting seeded demo providers.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261021130000', '20261021130000_social_profile_links_and_demo_guard', ARRAY['-- 20261021130000_social_profile_links_and_demo_guard']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261024090000_mirror_copy_logs_read.sql ==========
-- Mirror trading: let the owning user read copy execution events, so the
-- /copier-logs page can show mirror activity beside signal activity.
--
-- Both tables were created by 20261018170000_mirror_copy_engine.sql with row
-- security enabled and no user-facing SELECT policy, so until now only the
-- service role could read them. This adds read-only, owner-scoped access.
-- Nothing here writes or alters data, and the worker (service role) is
-- unaffected because service_role bypasses row security.

grant select on table mirror_copy_execution_events to authenticated;
grant select on table mirror_copy_trade_mappings to authenticated;

drop policy if exists "Users can view own mirror copy execution events" on mirror_copy_execution_events;
create policy "Users can view own mirror copy execution events"
  on mirror_copy_execution_events
  for select
  using (exists (
    select 1
      from broker_copy_links l
     where l.id = mirror_copy_execution_events.link_id
       and l.user_id = auth.uid()
  ));

drop policy if exists "Users can view own mirror copy trade mappings" on mirror_copy_trade_mappings;
create policy "Users can view own mirror copy trade mappings"
  on mirror_copy_trade_mappings
  for select
  using (exists (
    select 1
      from broker_copy_links l
     where l.id = mirror_copy_trade_mappings.link_id
       and l.user_id = auth.uid()
  ));

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261024090000', '20261024090000_mirror_copy_logs_read', ARRAY['-- 20261024090000_mirror_copy_logs_read']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261025120000_social_profile_links_validator_grant.sql ==========
-- The profile-links validator is used by authenticated profile operations.
-- Keep this permission explicit and reproducible.
GRANT EXECUTE
ON FUNCTION public.social_profile_links_are_valid(jsonb)
TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261025120000', '20261025120000_social_profile_links_validator_grant', ARRAY['-- 20261025120000_social_profile_links_validator_grant']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261026120000_mirror_copy_request_close.sql ==========
-- Mirror copy: let the owning user request a close of one copied trade.
--
-- The engine already has every piece needed to close a single copy: the ledger
-- state 'closing' (in the CHECK constraint since day one, and already treated as
-- "still ours to manage" by the delete guard), and the worker's closeMapping
-- path (event claim, re-read before send, uncertain retry). What was missing was
-- any way for a human to ask. This RPC is the ask: it records intent on the
-- mapping, and the worker honours it on its next reconcile tick (~20s), exactly
-- like set_mirror_copy_link_status records intent for start/pause/stop.
--
-- Deliberate choices:
--  * Only mappings in ('open', 'uncertain', 'error', 'closing') are accepted.
--    'opening' is excluded: the broker open may still be in flight and the
--    worker's finalizeOpen would overwrite the request, making it silently lost.
--    'closing' is accepted so a timed-out request can simply be retried.
--  * Once the worker sets 'closed', the unique key (link_id, source_ticket)
--    makes the engine's re-open attempt a silent no-op — a close stays closed
--    for the life of that master trade; no code path can duplicate the order.
--  * Any previous close event for the same source ticket that can no longer
--    advance is reset so this request can actually run again: status 'uncertain'
--    (retries exhausted — e.g. after a weekend "market is closed" rejection), or
--    status 'claimed' by a worker that then crashed and never completed it (the
--    staleness bound — 2 minutes — is safely beyond the worker's own stale-claim
--    lease of at least 60s, so a live in-flight claim is never clobbered). Without this a wedged close would be a
--    permanent dead-end no matter how often the user pressed the button.
-- ---------------------------------------------------------------------------
create or replace function public.request_mirror_copy_close(p_mapping_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link_id uuid;
  v_source_ticket text;
  v_updated integer;
begin
  select m.link_id, m.source_ticket
    into v_link_id, v_source_ticket
  from public.mirror_copy_trade_mappings m
  where m.id = p_mapping_id
    and exists (
      select 1 from public.broker_copy_links l
      where l.id = m.link_id
        and (l.user_id = auth.uid() or auth.role() = 'service_role')
    );

  if v_link_id is null then
    -- Uniform refusal (same as set_mirror_copy_link_status): a missing mapping
    -- and a foreign mapping answer identically, so the response leaks nothing
    -- about which mapping ids exist.
    raise exception 'not authorized for this mirror copy' using errcode = '42501';
  end if;

  update public.mirror_copy_trade_mappings
     set state = 'closing'
   where id = p_mapping_id
     and state in ('open', 'uncertain', 'error', 'closing');
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  update public.mirror_copy_execution_events
     set status = 'failed',
         attempt_count = 1,
         completed_at = null,
         error_code = null,
         error_detail = null
   where link_id = v_link_id
     and idempotency_key = 'close:' || v_source_ticket
     and (status = 'uncertain'
          or (status = 'claimed' and updated_at < now() - interval '2 minutes'));

  return true;
end;
$$;

comment on function public.request_mirror_copy_close(uuid) is
  'Owner-scoped: marks one mirror-copy mapping as closing; the worker executes the close on its next reconcile tick.';

revoke all on function public.request_mirror_copy_close(uuid) from public, anon;
grant execute on function public.request_mirror_copy_close(uuid) to authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261026120000', '20261026120000_mirror_copy_request_close', ARRAY['-- 20261026120000_mirror_copy_request_close']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261026150000_broker_connection_events_all_providers.sql ==========
-- Connection-status transitions are recorded for every provider, so the
-- provider column has to accept every provider `broker_accounts` accepts.
--
-- `broker_connection_events_trigger()` inserts
-- `COALESCE(NEW.provider, 'fxsocket')` on every `connection_status` change,
-- and inserts the provider again for `mtapi_status` changes. With only
-- ('fxsocket', 'mtapi') allowed, any status transition on a cTrader, DXtrade,
-- TradeLocker, MatchTrader or crypto account failed the whole `broker_accounts`
-- update with a CHECK violation — the account could never move between
-- connected / error / disconnected once linked. No transition has happened on
-- such an account yet (verified: the table holds mtapi rows only), which is why
-- the defect has stayed latent.
--
-- `field` keeps its own two-value check: it names the column that changed and
-- the trigger only ever writes those two.

alter table public.broker_connection_events
  drop constraint if exists broker_connection_events_provider_check;

alter table public.broker_connection_events
  add constraint broker_connection_events_provider_check
    check (provider in ('fxsocket', 'mtapi', 'ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker', 'matchtrader'));

comment on constraint broker_connection_events_provider_check on public.broker_connection_events is
  'Same provider list as broker_accounts_provider_check: every status transition the trigger records has to be storable.';

-- The comment above is informational; a comment on a constraint needs no extra
-- privilege beyond table ownership, and the migration runs as the project owner.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261026150000', '20261026150000_broker_connection_events_all_providers', ARRAY['-- 20261026150000_broker_connection_events_all_providers']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261026150100_broker_accounts_guard_margin_mode.sql ==========
-- The credential guard must also keep `broker_accounts.margin_mode` worker-owned.
--
-- `20261018180000_broker_accounts_margin_mode.sql` added the two assignments that
-- pin that column on client writes. Three later migrations (`20261019090000`
-- dxtrade, `20261019120000` tradelocker, `20261020100000` match-trader) each
-- reproduced the whole guard body to add their own columns — and every one of
-- them dropped those two lines, so the function that is actually live no longer
-- mentions `margin_mode` at all (verified against the live function body: it is
-- byte-identical to the match-trader version).
--
-- Practical exposure is limited — `authenticated` only holds a column-scoped
-- `update (copy_source)` grant on `broker_accounts`, and privilege checks run
-- before triggers — but the defence in depth is gone, and mirror copy now *reads*
-- this column to decide whether a slave account may be copied onto at all, so a
-- client that could write it would be writing a safety gate.
--
-- The body below is the live body (the match-trader version) verbatim, plus the
-- two `margin_mode` lines. Nothing else changes: reproducing anything less would
-- silently drop protection for the columns the later migrations added.

create or replace function public.broker_accounts_guard_mtapi_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.mtapi_session_id := null;
    new.broker_password_encrypted := null;
    new.auto_reconnect_enabled := false;
    new.password_updated_at := null;
    new.ctrader_access_token_encrypted := null;
    new.ctrader_refresh_token_encrypted := null;
    new.ctrader_token_expires_at := null;
    new.ctrader_client_id_encrypted := null;
    new.ctrader_client_secret_encrypted := null;
    new.binance_api_key_encrypted := null;
    new.binance_api_secret_encrypted := null;
    new.binance_account_id := null;
    new.binance_margin_usdt := null;
    new.binance_leverage := null;
    new.binance_margin_mode := null;
    new.bybit_api_key_encrypted := null;
    new.bybit_api_secret_encrypted := null;
    new.bybit_account_id := null;
    new.bybit_margin_usdt := null;
    new.bybit_leverage := null;
    new.kucoin_api_key_encrypted := null;
    new.kucoin_api_secret_encrypted := null;
    new.kucoin_passphrase_encrypted := null;
    new.kucoin_account_id := null;
    new.kucoin_margin_usdt := null;
    new.kucoin_leverage := null;
    new.kucoin_margin_mode := null;
    new.dxtrade_password_encrypted := null;
    new.dxtrade_account_id := null;
    new.dxtrade_server_url := null;
    new.dxtrade_username := null;
    new.dxtrade_domain := null;
    new.dxtrade_account_code := null;
    new.dxtrade_is_position_based := null;
    new.tradelocker_password_encrypted := null;
    new.tradelocker_account_id := null;
    new.tradelocker_environment := null;
    new.tradelocker_server := null;
    new.tradelocker_email := null;
    new.tradelocker_account_ref := null;
    new.tradelocker_acc_num := null;
    new.matchtrader_password_encrypted := null;
    new.matchtrader_account_id := null;
    new.matchtrader_server_url := null;
    new.matchtrader_broker_id := null;
    new.matchtrader_email := null;
    new.matchtrader_trading_account_uuid := null;
    new.matchtrader_system_uuid := null;
    new.margin_mode := 'unknown';
  else
    new.mtapi_session_id := old.mtapi_session_id;
    new.broker_password_encrypted := old.broker_password_encrypted;
    new.auto_reconnect_enabled := old.auto_reconnect_enabled;
    new.password_updated_at := old.password_updated_at;
    new.ctrader_access_token_encrypted := old.ctrader_access_token_encrypted;
    new.ctrader_refresh_token_encrypted := old.ctrader_refresh_token_encrypted;
    new.ctrader_token_expires_at := old.ctrader_token_expires_at;
    new.ctrader_client_id_encrypted := old.ctrader_client_id_encrypted;
    new.ctrader_client_secret_encrypted := old.ctrader_client_secret_encrypted;
    new.binance_api_key_encrypted := old.binance_api_key_encrypted;
    new.binance_api_secret_encrypted := old.binance_api_secret_encrypted;
    new.binance_account_id := old.binance_account_id;
    new.binance_margin_usdt := old.binance_margin_usdt;
    new.binance_leverage := old.binance_leverage;
    new.binance_margin_mode := old.binance_margin_mode;
    new.bybit_api_key_encrypted := old.bybit_api_key_encrypted;
    new.bybit_api_secret_encrypted := old.bybit_api_secret_encrypted;
    new.bybit_account_id := old.bybit_account_id;
    new.bybit_margin_usdt := old.bybit_margin_usdt;
    new.bybit_leverage := old.bybit_leverage;
    new.kucoin_api_key_encrypted := old.kucoin_api_key_encrypted;
    new.kucoin_api_secret_encrypted := old.kucoin_api_secret_encrypted;
    new.kucoin_passphrase_encrypted := old.kucoin_passphrase_encrypted;
    new.kucoin_account_id := old.kucoin_account_id;
    new.kucoin_margin_usdt := old.kucoin_margin_usdt;
    new.kucoin_leverage := old.kucoin_leverage;
    new.kucoin_margin_mode := old.kucoin_margin_mode;
    new.dxtrade_password_encrypted := old.dxtrade_password_encrypted;
    new.dxtrade_account_id := old.dxtrade_account_id;
    new.dxtrade_server_url := old.dxtrade_server_url;
    new.dxtrade_username := old.dxtrade_username;
    new.dxtrade_domain := old.dxtrade_domain;
    new.dxtrade_account_code := old.dxtrade_account_code;
    new.dxtrade_is_position_based := old.dxtrade_is_position_based;
    new.tradelocker_password_encrypted := old.tradelocker_password_encrypted;
    new.tradelocker_account_id := old.tradelocker_account_id;
    new.tradelocker_environment := old.tradelocker_environment;
    new.tradelocker_server := old.tradelocker_server;
    new.tradelocker_email := old.tradelocker_email;
    new.tradelocker_account_ref := old.tradelocker_account_ref;
    new.tradelocker_acc_num := old.tradelocker_acc_num;
    new.matchtrader_password_encrypted := old.matchtrader_password_encrypted;
    new.matchtrader_account_id := old.matchtrader_account_id;
    new.matchtrader_server_url := old.matchtrader_server_url;
    new.matchtrader_broker_id := old.matchtrader_broker_id;
    new.matchtrader_email := old.matchtrader_email;
    new.matchtrader_trading_account_uuid := old.matchtrader_trading_account_uuid;
    new.matchtrader_system_uuid := old.matchtrader_system_uuid;
    new.margin_mode := old.margin_mode;
  end if;
  return new;
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261026150100', '20261026150100_broker_accounts_guard_margin_mode', ARRAY['-- 20261026150100_broker_accounts_guard_margin_mode']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261027100000_social_multi_account_sources.sql ==========
-- Allow providers to share broker accounts independently. Subscriptions remain
-- source-account-specific and revocation requests a worker-acknowledged pause.

drop index if exists public.social_copy_sources_one_published_per_trader_idx;

create or replace function public.publish_social_copy_source(
  p_broker_account_id uuid,
  p_label text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social copy source publishing requires a verified account' using errcode = '42501';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before publishing a copy source' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = p_broker_account_id and b.user_id = v_actor
  ) then
    raise exception 'Broker account is not owned by the current user' using errcode = '42501';
  end if;

  insert into public.social_copy_sources (trader_user_id, broker_account_id, status, label)
  values (v_actor, p_broker_account_id, 'published', nullif(btrim(p_label), ''))
  on conflict (broker_account_id) do update set
    status = 'published', label = excluded.label, updated_at = now()
  where public.social_copy_sources.trader_user_id = v_actor
  returning id into v_id;
  if v_id is null then raise exception 'Copy source belongs to another trader' using errcode = '42501'; end if;
  return v_id;
end;
$$;

create or replace function public.set_social_copy_source_status(p_source_id uuid, p_status text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_status not in ('published', 'paused', 'retired') then
    raise exception 'Invalid copy source status' using errcode = '22023';
  end if;

  update public.social_copy_sources
  set status = p_status, updated_at = now()
  where id = p_source_id and trader_user_id = v_actor;
  if not found then raise exception 'Copy source was not found' using errcode = 'P0002'; end if;

  if p_status <> 'published' then
    update public.social_copy_subscriptions
    set desired_status = 'paused', updated_at = now()
    where source_id = p_source_id
      and status not in ('stopped', 'emergency_stopped')
      and desired_status <> 'stopped';
  end if;
end;
$$;

drop function public.get_social_copy_sources(uuid);
create function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (
  source_id uuid,
  trader_user_id uuid,
  label text,
  provider text,
  platform text,
  account_hint text,
  account_mode text,
  connection_healthy boolean,
  is_copy_eligible boolean,
  eligibility_reason text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.trader_user_id, coalesce(s.label, 'Copy source'),
    coalesce(b.provider, 'fxsocket'), b.platform,
    case
      when nullif(btrim(b.account_login), '') is null then 'Identifier unavailable'
      else repeat(chr(8226), 4) || right(btrim(b.account_login), 4)
    end,
    case when lower(coalesce(b.linked_account_type, '')) in ('demo', 'practice') then 'demo'
         when lower(coalesce(b.linked_account_type, '')) = 'live' then 'live'
         when lower(coalesce(b.ctrader_environment, b.binance_environment, b.bybit_environment, b.tradelocker_environment, '')) = 'demo' then 'demo'
         when lower(coalesce(b.ctrader_environment, b.binance_environment, b.bybit_environment, b.tradelocker_environment, '')) = 'live' then 'live'
         else 'unknown' end,
    (b.is_active = true and b.connection_status in ('connected', 'healthy')),
    (eligibility.eligible and not sp.is_synthetic_demo),
    case when sp.is_synthetic_demo then 'synthetic_demo' else eligibility.reason end
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (sp.access_mode = 'open' or s.trader_user_id = auth.uid()
      or exists (select 1 from public.social_follow_relationships r
        where r.follower_user_id = auth.uid() and r.followed_user_id = s.trader_user_id and r.status = 'accepted'))
  order by s.created_at, s.id;
$$;

revoke all on function public.publish_social_copy_source(uuid, text) from public, anon;
revoke all on function public.set_social_copy_source_status(uuid, text) from public, anon;
revoke all on function public.get_social_copy_sources(uuid) from public, anon;
grant execute on function public.publish_social_copy_source(uuid, text) to authenticated;
grant execute on function public.set_social_copy_source_status(uuid, text) to authenticated;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;

comment on function public.publish_social_copy_source(uuid, text) is
  'Explicitly shares one owned broker account without changing any other account sharing preference.';
comment on function public.set_social_copy_source_status(uuid, text) is
  'Changes one owned source. Revocation requests pauses for current subscriptions; it does not silently delete them.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261027100000', '20261027100000_social_multi_account_sources', ARRAY['-- 20261027100000_social_multi_account_sources']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261027110000_social_full_flow_preview.sql ==========
-- Complete Social Trading account-mode, authorization, and preview-simulation
-- behavior. The synthetic path is server-controlled and default-off.

create table if not exists public.social_copy_runtime_config (
  singleton boolean primary key default true check (singleton),
  environment_name text not null default 'unconfigured',
  allow_synthetic_participants boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.social_copy_runtime_config (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.social_copy_runtime_config enable row level security;
revoke all on table public.social_copy_runtime_config from public, anon, authenticated;
grant select, insert, update on table public.social_copy_runtime_config to service_role;

comment on table public.social_copy_runtime_config is
  'Server-only Social Trading environment gates. Synthetic participation defaults off and must only be enabled in an isolated preview project.';
comment on column public.social_copy_runtime_config.allow_synthetic_participants is
  'Allows persisted synthetic subscription lifecycles. It never authorizes broker execution; workers must use the isolated synthetic simulation path.';

create or replace function public.social_copy_synthetic_participants_enabled()
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select c.allow_synthetic_participants
    from public.social_copy_runtime_config c
    where c.singleton = true
      and c.environment_name = 'migration-preview'
  ), false);
$$;

revoke all on function public.social_copy_synthetic_participants_enabled()
  from public, anon, authenticated;

create or replace function public.social_broker_account_mode(p_broker_account_id uuid)
returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  with account_values as (
    select
      lower(btrim(coalesce(b.linked_account_type, ''))) as linked_type,
      lower(btrim(coalesce(
        case lower(coalesce(b.provider, ''))
          when 'ctrader' then b.ctrader_environment
          when 'binance' then b.binance_environment
          when 'bybit' then b.bybit_environment
          when 'tradelocker' then b.tradelocker_environment
          else null
        end,
        ''
      ))) as provider_environment
    from public.broker_accounts b
    where b.id = p_broker_account_id
  ), normalized as (
    select
      case when linked_type in ('demo', 'practice') then 'demo'
           when linked_type = 'live' then 'live'
           else 'unknown' end as linked_mode,
      case when provider_environment in ('demo', 'live') then provider_environment
           else 'unknown' end as environment_mode
    from account_values
  )
  select case
    when linked_mode <> 'unknown' and environment_mode <> 'unknown'
      and linked_mode <> environment_mode then 'unknown'
    when linked_mode <> 'unknown' then linked_mode
    when environment_mode <> 'unknown' then environment_mode
    else 'unknown'
  end
  from normalized;
$$;

revoke all on function public.social_broker_account_mode(uuid)
  from public, anon, authenticated;
grant execute on function public.social_broker_account_mode(uuid) to service_role;

alter table public.social_copy_subscriptions
  add column if not exists source_account_mode text not null default 'unknown'
    check (source_account_mode in ('demo', 'live', 'unknown')),
  add column if not exists destination_account_mode text not null default 'unknown'
    check (destination_account_mode in ('demo', 'live', 'unknown')),
  add column if not exists execution_path text not null default 'broker'
    check (execution_path in ('broker', 'synthetic_simulation'));

update public.social_copy_subscriptions subscription
set source_account_mode = coalesce(public.social_broker_account_mode(source.broker_account_id), 'unknown'),
    destination_account_mode = coalesce(public.social_broker_account_mode(subscription.destination_broker_account_id), 'unknown'),
    execution_path = case
      when source.is_synthetic = true
        or source_profile.is_synthetic_demo = true
        or exists (
          select 1 from public.social_profiles subscriber_profile
          where subscriber_profile.user_id = subscription.subscriber_user_id
            and subscriber_profile.is_synthetic_demo = true)
      then 'synthetic_simulation'
      else 'broker'
    end
from public.social_copy_sources source
join public.social_profiles source_profile on source_profile.user_id = source.trader_user_id
where source.id = subscription.source_id;


-- The historical guard correctly protected production but would pause every
-- preview source whenever the idempotent seed refreshed its synthetic marker.
drop trigger if exists social_copy_sources_pause_synthetic_subscriptions
  on public.social_copy_sources;
comment on column public.social_copy_subscriptions.source_account_mode is
  'Trusted source mode captured when the subscription is created.';
comment on column public.social_copy_subscriptions.destination_account_mode is
  'Trusted destination mode captured when the subscription is created.';
comment on column public.social_copy_subscriptions.execution_path is
  'broker for genuine accounts; synthetic_simulation permanently prevents broker execution for synthetic participants.';

create or replace function public.social_source_performance_eligibility(p_source_id uuid)
returns table (eligible boolean, reason text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with source_context as (
    select
      s.id, s.status, s.trader_user_id, s.broker_account_id, s.is_synthetic,
      sp.is_synthetic_demo,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    join public.social_profiles sp on sp.user_id = s.trader_user_id
    where s.id = p_source_id
  ), scoped as (
    select distinct on (t.broker_account_id, coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text))
      t.id, t.broker_account_id, t.metaapi_order_id, t.status, t.opened_at,
      t.closed_at, t.profit, t.created_at
    from public.trades t
    join source_context sc on sc.broker_account_id = t.broker_account_id
    where (lower(t.status) = 'open' or t.closed_at is not null or lower(t.status) = 'closed')
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings map on map.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and map.destination_ticket is not null
          and map.destination_ticket = t.metaapi_order_id
      )
    order by t.broker_account_id,
      coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text),
      t.created_at desc, t.id desc
  ), facts as (
    select
      count(*) filter (where lower(status) = 'closed' or closed_at is not null) as closed_count,
      count(*) filter (where (lower(status) = 'closed' or closed_at is not null)
        and (profit is null or metaapi_order_id is null or btrim(metaapi_order_id) = '')) as incomplete_count,
      min(opened_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_start,
      max(closed_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_end
    from scoped
  )
  select
    case
      when sc.id is null then false
      when sc.status <> 'published' then false
      when (sc.is_synthetic or sc.is_synthetic_demo)
        and not public.social_copy_synthetic_participants_enabled() then false
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then false
      when sc.account_mode not in ('demo', 'live') then false
      when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then false
      when sc.last_synced_at is null then false
      when sc.last_synced_at < now() - interval '15 minutes' then false
      when coalesce(f.incomplete_count, 0) > 0 then false
      when coalesce(f.closed_count, 0) < 10 then false
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then false
      else true
    end,
    case
      when sc.id is null then 'source_missing'
      when sc.status <> 'published' then 'source_not_published'
      when (sc.is_synthetic or sc.is_synthetic_demo)
        and not public.social_copy_synthetic_participants_enabled() then 'synthetic_preview_disabled'
      when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
      when sc.account_mode not in ('demo', 'live') then 'account_mode_unknown'
      when not sc.is_active then 'source_inactive'
      when sc.connection_status = 'error' then 'sync_failed'
      when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
      when sc.last_synced_at is null then 'sync_pending'
      when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
      when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
      when coalesce(f.closed_count, 0) < 10 then 'minimum_trades_not_met'
      when f.period_start is null or f.period_end is null
        or f.period_end - f.period_start < interval '7 days' then 'minimum_period_not_met'
      else 'eligible'
    end
  from (select 1) seed
  left join source_context sc on true
  left join facts f on true;
$$;

revoke all on function public.social_source_performance_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_performance_eligibility(uuid) to service_role;

comment on function public.social_source_performance_eligibility(uuid) is
  'Server-side eligibility for published owned Demo or Live MT sources with trusted mode, healthy/fresh sync, complete history, and preview-only synthetic gating.';

create or replace function public.publish_social_copy_source(
  p_broker_account_id uuid,
  p_label text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social copy source publishing requires a verified account' using errcode = '42501';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before publishing a copy source' using errcode = '55000';
  end if;
  -- First: verify ownership so another user's account is never publishable.
if not exists (
  select 1
  from public.broker_accounts b
  where b.id = p_broker_account_id
    and b.user_id = v_actor
) then
  raise exception 'Broker account is not owned by the current user'
    using errcode = '42501';
end if;

-- Second: verify eligibility for Social Trading.
if not exists (
  select 1
  from public.broker_accounts b
  where b.id = p_broker_account_id
    and b.user_id = v_actor
    and b.is_active = true
    and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')
    and lower(coalesce(nullif(b.provider, ''), 'fxsocket')) in ('fxsocket', 'mtapi')
    and upper(coalesce(b.platform, '')) in ('MT4', 'MT5')
    and public.social_broker_account_mode(b.id) in ('demo', 'live')
) then
  raise exception 'Broker account is not connected, supported, or mode-verified for Social Trading'
    using errcode = '55000';
end if;

  insert into public.social_copy_sources (trader_user_id, broker_account_id, status, label)
  values (v_actor, p_broker_account_id, 'published', nullif(btrim(p_label), ''))
  on conflict (broker_account_id) do update set
    status = 'published', label = excluded.label, updated_at = now()
  where public.social_copy_sources.trader_user_id = v_actor
  returning id into v_id;
  if v_id is null then raise exception 'Copy source belongs to another trader' using errcode = '42501'; end if;
  return v_id;
end;
$$;

revoke all on function public.publish_social_copy_source(uuid, text) from public, anon;
grant execute on function public.publish_social_copy_source(uuid, text) to authenticated;

comment on function public.publish_social_copy_source(uuid, text) is
  'Shares one independently selected owned, connected, supported Demo or Live account without changing other shared accounts.';

drop function public.get_social_copy_sources(uuid);
create function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (
  source_id uuid,
  label text,
  provider text,
  platform text,
  account_hint text,
  account_mode text,
  connection_healthy boolean,
  is_copy_eligible boolean,
  eligibility_reason text,
  is_synthetic boolean
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, coalesce(s.label, 'Copy source'),
    coalesce(b.provider, 'fxsocket'), b.platform,
    case
      when nullif(btrim(b.account_login), '') is null then 'Identifier unavailable'
      else repeat(chr(8226), 4) || right(btrim(b.account_login), 4)
    end,
    coalesce(public.social_broker_account_mode(b.id), 'unknown'),
    (b.is_active = true and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')),
    eligibility.eligible,
    eligibility.reason,
    (s.is_synthetic = true or sp.is_synthetic_demo = true)
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (sp.access_mode = 'open' or s.trader_user_id = auth.uid()
      or exists (select 1 from public.social_follow_relationships r
        where r.follower_user_id = auth.uid()
          and r.followed_user_id = s.trader_user_id
          and r.status = 'accepted'))
  order by s.created_at, s.id;
$$;

revoke all on function public.get_social_copy_sources(uuid) from public, anon;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;

create or replace function public.reject_synthetic_social_copy_subscription()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_synthetic boolean;
begin
  select source.is_synthetic = true
      or source_profile.is_synthetic_demo = true
      or coalesce(subscriber_profile.is_synthetic_demo, false) = true
  into v_synthetic
  from public.social_copy_sources source
  join public.social_profiles source_profile on source_profile.user_id = source.trader_user_id
  left join public.social_profiles subscriber_profile on subscriber_profile.user_id = new.subscriber_user_id
  where source.id = new.source_id;

  if coalesce(v_synthetic, false) and not public.social_copy_synthetic_participants_enabled() then
    raise exception 'Synthetic Social Trading participants are disabled in this environment'
      using errcode = '42501';
  end if;
  if coalesce(v_synthetic, false) and new.execution_path <> 'synthetic_simulation' then
    raise exception 'Synthetic Social Trading subscriptions require the simulation execution path'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_synthetic_social_copy_subscription on public.social_copy_subscriptions;
create trigger reject_synthetic_social_copy_subscription
before insert or update of source_id, subscriber_user_id, destination_broker_account_id, execution_path
on public.social_copy_subscriptions
for each row execute function public.reject_synthetic_social_copy_subscription();

revoke all on function public.reject_synthetic_social_copy_subscription()
  from public, anon, authenticated;

create or replace function public.create_social_copy_subscription(
  p_source_id uuid,
  p_destination_broker_account_id uuid,
  p_sizing_mode text,
  p_fixed_lot numeric,
  p_lot_multiplier numeric,
  p_max_lot numeric,
  p_max_daily_loss numeric default null,
  p_requested_account_mode text default 'demo',
  p_symbol_map jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor uuid := auth.uid();
  v_source public.social_copy_sources%rowtype;
  v_source_selection record;
  v_access text;
  v_source_mode text;
  v_destination_mode text;
  v_source_synthetic boolean := false;
  v_subscriber_synthetic boolean := false;
  v_execution_path text := 'broker';
  v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before copying a trader' using errcode = '55000';
  end if;

  -- Return a specific error for visible, published providers with stale history.
  -- Preserve privacy: do not reveal eligibility details for inaccessible sources.
  if exists (
    select 1
    from public.social_copy_sources s
    join public.social_profiles sp
      on sp.user_id = s.trader_user_id
    cross join lateral
      public.social_source_performance_eligibility(s.id) eligibility
    where s.id = p_source_id
      and s.status = 'published'
      and sp.is_listed = true
      and eligibility.reason = 'history_stale'
      and (
        sp.access_mode = 'open'
        or s.trader_user_id = v_actor
        or exists (
          select 1
          from public.social_follow_relationships r
          where r.follower_user_id = v_actor
            and r.followed_user_id = s.trader_user_id
            and r.status = 'accepted'
        )
      )
  ) then
    raise exception 'Provider is not eligible for copying: history_stale'
      using errcode = '55000';
  end if;

  select
    s as source,
    sp.access_mode as access_mode,
    (s.is_synthetic = true or sp.is_synthetic_demo = true) as is_synthetic
  into v_source_selection
  from public.social_copy_sources s
  join public.social_profiles sp on sp.user_id = s.trader_user_id
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.id = p_source_id and s.status = 'published' and sp.is_listed = true
    and eligibility.eligible = true;
  if not found then raise exception 'Social copy source is unavailable or ineligible' using errcode = 'P0002'; end if;
  v_source := v_source_selection.source;
  v_access := v_source_selection.access_mode;
  v_source_synthetic := v_source_selection.is_synthetic;
  if v_source.trader_user_id = v_actor then raise exception 'Users cannot copy themselves' using errcode = '23514'; end if;
  if v_access = 'private' and not exists (
    select 1 from public.social_follow_relationships r
    where r.follower_user_id = v_actor and r.followed_user_id = v_source.trader_user_id
      and r.status = 'accepted'
  ) then raise exception 'An accepted follow is required for this private trader' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.broker_accounts b
    where b.id = p_destination_broker_account_id and b.user_id = v_actor
      and b.is_active = true
      and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')
      and lower(coalesce(nullif(b.provider, ''), 'fxsocket')) in ('fxsocket', 'mtapi')
      and upper(coalesce(b.platform, '')) in ('MT4', 'MT5')
  ) then
    raise exception 'Destination account is not owned, connected, or supported for Social Trading' using errcode = '42501';
  end if;

  v_source_mode := coalesce(public.social_broker_account_mode(v_source.broker_account_id), 'unknown');
  v_destination_mode := coalesce(public.social_broker_account_mode(p_destination_broker_account_id), 'unknown');
  if v_source_mode not in ('demo', 'live') or v_destination_mode not in ('demo', 'live') then
    raise exception 'Source and destination account modes must be verified' using errcode = '22023';
  end if;
  if p_requested_account_mode <> v_destination_mode then
    raise exception 'Destination account mode changed; review and confirm the selected account again' using errcode = '22023';
  end if;

  select coalesce(sp.is_synthetic_demo, false) into v_subscriber_synthetic
  from public.social_profiles sp where sp.user_id = v_actor;
  if v_source_synthetic or v_subscriber_synthetic then
    if not public.social_copy_synthetic_participants_enabled() then
      raise exception 'Synthetic Social Trading participants are disabled in this environment' using errcode = '42501';
    end if;
    v_execution_path := 'synthetic_simulation';
  end if;

  if p_sizing_mode not in ('fixed_lot', 'lot_multiplier', 'equity_ratio')
    or p_requested_account_mode not in ('demo', 'live')
    or coalesce(p_lot_multiplier, 0) <= 0 or coalesce(p_lot_multiplier, 0) > 100
    or coalesce(p_max_lot, 0) <= 0 or coalesce(p_max_lot, 0) > 1000
    or (p_sizing_mode = 'fixed_lot' and (coalesce(p_fixed_lot, 0) <= 0 or p_fixed_lot > p_max_lot))
    or (p_max_daily_loss is not null and p_max_daily_loss <= 0)
    or jsonb_typeof(coalesce(p_symbol_map, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid social copy risk settings' using errcode = '22023';
  end if;

  insert into public.social_copy_subscriptions (
    source_id, source_trader_user_id, subscriber_user_id, destination_broker_account_id,
    sizing_mode, fixed_lot, lot_multiplier, max_lot, max_daily_loss,
    requested_account_mode, source_account_mode, destination_account_mode,
    execution_path, symbol_map
  ) values (
    p_source_id, v_source.trader_user_id, v_actor, p_destination_broker_account_id,
    p_sizing_mode, case when p_sizing_mode = 'fixed_lot' then p_fixed_lot else null end,
    p_lot_multiplier, p_max_lot, p_max_daily_loss,
    v_destination_mode, v_source_mode, v_destination_mode,
    v_execution_path, coalesce(p_symbol_map, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A current subscription already exists for this source and destination' using errcode = '23505';
end;
$$;

revoke all on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.create_social_copy_subscription(uuid, uuid, text, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

create or replace function public.check_social_copy_subscription_authorization(p_subscription_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when current_user in ('service_role', 'postgres') then exists (
    select 1
    from public.social_copy_subscriptions s
    join public.social_copy_sources src on src.id = s.source_id
    join public.social_profiles sp on sp.user_id = src.trader_user_id
    left join public.social_profiles subscriber_profile on subscriber_profile.user_id = s.subscriber_user_id
    join public.broker_accounts source_account on source_account.id = src.broker_account_id
    join public.broker_accounts destination_account on destination_account.id = s.destination_broker_account_id
    cross join lateral public.social_source_performance_eligibility(src.id) eligibility
    where s.id = p_subscription_id
      and eligibility.eligible = true
      and src.status = 'published' and sp.is_listed = true
      and source_account.user_id = src.trader_user_id
      and destination_account.user_id = s.subscriber_user_id
      and destination_account.is_active = true
      and lower(coalesce(destination_account.connection_status, '')) in ('connected', 'healthy')
      and lower(coalesce(nullif(destination_account.provider, ''), 'fxsocket')) in ('fxsocket', 'mtapi')
      and upper(coalesce(destination_account.platform, '')) in ('MT4', 'MT5')
      and public.social_broker_account_mode(source_account.id) = s.source_account_mode
      and public.social_broker_account_mode(destination_account.id) = s.destination_account_mode
      and s.requested_account_mode = s.destination_account_mode
      and (
        ((src.is_synthetic = true or sp.is_synthetic_demo = true
          or coalesce(subscriber_profile.is_synthetic_demo, false) = true)
          and public.social_copy_synthetic_participants_enabled()
          and s.execution_path = 'synthetic_simulation')
        or
        ((src.is_synthetic = false and sp.is_synthetic_demo = false
          and coalesce(subscriber_profile.is_synthetic_demo, false) = false)
          and s.execution_path = 'broker')
      )
      and (sp.access_mode = 'open' or exists (
        select 1 from public.social_follow_relationships r
        where r.follower_user_id = s.subscriber_user_id
          and r.followed_user_id = src.trader_user_id
          and r.status = 'accepted'
      ))
  ) else false end;
$$;

revoke all on function public.check_social_copy_subscription_authorization(uuid)
  from public, anon, authenticated;
grant execute on function public.check_social_copy_subscription_authorization(uuid) to service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261027110000', '20261027110000_social_full_flow_preview', ARRAY['-- 20261027110000_social_full_flow_preview']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261027120000_mirror_copy_close_reason.sql ==========
-- ---------------------------------------------------------------------------
-- Mirror copy: remember why a copied trade was closed.
--
-- Mirror copies are broker-side positions; the engine never writes a `trades`
-- row for them. Without a reason on the ledger the trade detail modal could only
-- say "No close reason was recorded", even when the customer had just used
-- Close copy. The worker now stamps this column in the same UPDATE that sets
-- state='closed', so the UI can explain the close.
--
-- Values are intentionally the same vocabulary the UI already understands:
--   user_force_close     - the customer closed the copy, stopped copying, or
--                          removed the slave (the worker flattens first)
--   mirror_source_closed - the master trade closed and the copy followed it
--   position_gone        - the broker position disappeared before the engine
--                          closed it (manual close, stop loss, take profit)
-- Existing rows stay NULL; the UI shows a neutral "closed by the copier" line
-- for those instead of pretending to know.
-- ---------------------------------------------------------------------------
alter table public.mirror_copy_trade_mappings
  add column if not exists close_reason text;

comment on column public.mirror_copy_trade_mappings.close_reason is
  'Why the copier closed this copy: user_force_close, mirror_source_closed, or position_gone. NULL for rows closed before this column existed.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261027120000', '20261027120000_mirror_copy_close_reason', ARRAY['-- 20261027120000_mirror_copy_close_reason']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261028120000_social_diagnostics_notifications.sql ==========
-- Additive diagnostics and persistent social notifications. Existing eligibility
-- rules remain authoritative; this migration only explains every check.

create or replace function public.social_source_eligibility_diagnostics(p_source_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with source_context as (
    select s.id, s.status, s.broker_account_id, s.is_synthetic, sp.is_synthetic_demo,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform, b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    join public.social_profiles sp on sp.user_id = s.trader_user_id
    where s.id = p_source_id
  ), scoped as (
    select distinct on (t.broker_account_id, coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text))
      t.id, t.broker_account_id, t.metaapi_order_id, t.status, t.opened_at,
      t.closed_at, t.profit, t.created_at
    from public.trades t
    join source_context sc on sc.broker_account_id = t.broker_account_id
    where (lower(t.status) = 'open' or t.closed_at is not null or lower(t.status) = 'closed')
      and not exists (
        select 1 from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings map on map.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and map.destination_ticket is not null and map.destination_ticket = t.metaapi_order_id
      )
    order by t.broker_account_id, coalesce(nullif(t.metaapi_order_id, ''), 'row:' || t.id::text), t.created_at desc, t.id desc
  ), facts as (
    select count(*) filter (where lower(status) = 'closed' or closed_at is not null) as closed_count,
      count(*) filter (where (lower(status) = 'closed' or closed_at is not null)
        and (profit is null or metaapi_order_id is null or btrim(metaapi_order_id) = '')) as incomplete_count,
      min(opened_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_start,
      max(closed_at) filter (where lower(status) = 'closed' or closed_at is not null) as period_end
    from scoped
  ), context as (
    select sc.*, coalesce(f.closed_count, 0) as closed_count,
      coalesce(f.incomplete_count, 0) as incomplete_count, f.period_start, f.period_end
    from (select 1) seed left join source_context sc on true cross join facts f
  ), checks as (
    select v.* from context c cross join lateral (values
      (0, case when c.id is null then 'source_missing' else 'source_present' end,
        case when c.id is null then 'blocked' else 'passed' end,
        case when c.id is null then 'error' else 'success' end,
        case when c.id is null then 'The selected source account no longer exists or is not owned by this trader.' else 'The source account exists and is owned by the publishing trader.' end,
        case when c.id is null then 'Choose another owned source account or publish a new one.' else null end,
        c.id is null),
      (1, case when c.status = 'published' then 'source_published' else 'source_not_published' end,
        case when c.status = 'published' then 'passed' else 'blocked' end,
        case when c.status = 'published' then 'success' else 'warning' end,
        case when c.status = 'published' then 'The trader explicitly published this source account.' else 'This source account has not been published for Social Trading.' end,
        case when c.status = 'published' then null else 'Publish this account from Social Trading settings.' end,
        c.status is distinct from 'published'),
      (2, case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'synthetic_preview_disabled' else 'synthetic_policy_passed' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'blocked' else 'passed' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'warning' else 'success' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'This synthetic demo source is restricted to an isolated preview environment.' else 'The source passes the preview-only synthetic participation policy.' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'Use Migration Preview with synthetic participation enabled, or select a genuine connected account.' else null end,
        coalesce((c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled(), false)),
      (3, case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'source_supported' else 'source_unsupported' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'passed' else 'blocked' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'success' else 'error' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'The source provider and platform are supported.' else 'This broker provider or platform is not supported for verified Social Trading performance.' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then null else 'Connect a supported FxSocket or MTAPI MT4/MT5 account.' end,
        coalesce(c.provider not in ('fxsocket', 'mtapi') or c.platform not in ('MT4', 'MT5'), true)),
      (4, case when c.account_mode in ('demo', 'live') then 'account_mode_verified' else 'account_mode_unknown' end,
        case when c.account_mode in ('demo', 'live') then 'passed' else 'pending' end,
        case when c.account_mode in ('demo', 'live') then 'success' else 'info' end,
        case when c.account_mode in ('demo', 'live') then 'The broker verified whether this is a demo or live account.' else 'The account demo/live mode has not been verified yet.' end,
        case when c.account_mode in ('demo', 'live') then null else 'Reconnect or synchronize the account so its mode can be verified.' end,
        coalesce(c.account_mode not in ('demo', 'live'), true)),
      (5, case when c.is_active then 'source_active' else 'source_inactive' end,
        case when c.is_active then 'passed' else 'blocked' end,
        case when c.is_active then 'success' else 'error' end,
        case when c.is_active then 'The source account is active.' else 'The source account is inactive.' end,
        case when c.is_active then null else 'Activate the broker connection before using it as a source.' end,
        not coalesce(c.is_active, false)),
      (6, case when c.connection_status = 'error' then 'sync_failed' when c.connection_status not in ('connected', 'healthy') then 'source_disconnected' else 'source_connected' end,
        case when c.connection_status in ('connected', 'healthy') then 'passed' else 'blocked' end,
        case when c.connection_status in ('connected', 'healthy') then 'success' else 'error' end,
        case when c.connection_status = 'error' then 'The latest broker synchronization failed.' when c.connection_status not in ('connected', 'healthy') then 'The source account is disconnected from its broker.' else 'The source broker connection is healthy.' end,
        case when c.connection_status = 'error' then 'Repair or reconnect the broker account, then synchronize it again.' when c.connection_status not in ('connected', 'healthy') then 'Reconnect the source account and confirm that its connection is healthy.' else null end,
        coalesce(c.connection_status not in ('connected', 'healthy'), true)),
      (7, case when c.last_synced_at is null then 'sync_pending' when c.last_synced_at < now() - interval '15 minutes' then 'history_stale' else 'history_fresh' end,
        case when c.last_synced_at is null then 'pending' when c.last_synced_at < now() - interval '15 minutes' then 'blocked' else 'passed' end,
        case when c.last_synced_at is null then 'info' when c.last_synced_at < now() - interval '15 minutes' then 'error' else 'success' end,
        case when c.last_synced_at is null then 'The first successful source synchronization has not completed.' when c.last_synced_at < now() - interval '15 minutes' then 'The source history is older than the 15-minute freshness limit.' else 'The source history is within the 15-minute freshness limit.' end,
        case when c.last_synced_at is null then 'Keep the account connected and wait for synchronization to finish.' when c.last_synced_at < now() - interval '15 minutes' then 'Restore synchronization and wait for a fresh broker snapshot.' else null end,
        c.last_synced_at is null or c.last_synced_at < now() - interval '15 minutes'),
      (8, case when c.incomplete_count > 0 then 'history_incomplete' else 'history_complete' end,
        case when c.incomplete_count > 0 then 'blocked' else 'passed' end,
        case when c.incomplete_count > 0 then 'error' else 'success' end,
        case when c.incomplete_count > 0 then 'One or more closed trades are missing a verified broker ticket or realized result.' else 'All synchronized closed trades have a broker ticket and realized result.' end,
        case when c.incomplete_count > 0 then 'Synchronize the complete closed-trade history before publishing it for copying.' else null end,
        c.incomplete_count > 0),
      (9, case when c.closed_count < 10 then 'minimum_trades_not_met' else 'minimum_trades_met' end,
        case when c.closed_count < 10 then 'pending' else 'passed' end,
        case when c.closed_count < 10 then 'info' else 'success' end,
        case when c.closed_count < 10 then 'Fewer than 10 complete closed trades are available.' else 'At least 10 complete closed trades are available.' end,
        case when c.closed_count < 10 then 'Accumulate at least 10 complete closed trades and synchronize them.' else null end,
        c.closed_count < 10),
      (10, case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'minimum_period_not_met' else 'minimum_period_met' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'pending' else 'passed' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'info' else 'success' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'The verified closed-trade history spans less than 7 days.' else 'The verified closed-trade history spans at least 7 days.' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'Keep the account synchronized until its closed-trade history spans at least 7 days.' else null end,
        c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days')
    ) as v(check_order, code, status, severity, explanation, next_action, blocking)
    where c.id is not null or v.check_order = 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('order', check_order, 'code', code, 'status', status,
    'severity', severity, 'explanation', explanation, 'next_action', next_action, 'blocking', blocking)
    order by check_order), '[]'::jsonb) from checks;
$$;

revoke all on function public.social_source_eligibility_diagnostics(uuid) from public, anon, authenticated;
grant execute on function public.social_source_eligibility_diagnostics(uuid) to service_role;

drop function public.get_social_copy_sources(uuid);
create function public.get_social_copy_sources(p_trader_user_id uuid)
returns table (source_id uuid, label text, provider text, platform text, account_hint text,
  account_mode text, connection_healthy boolean, is_copy_eligible boolean,
  eligibility_reason text, is_synthetic boolean, eligibility_diagnostics jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, coalesce(s.label, 'Copy source'), coalesce(b.provider, 'fxsocket'), b.platform,
    case when nullif(btrim(b.account_login), '') is null then 'Identifier unavailable'
      else repeat(chr(8226), 4) || right(btrim(b.account_login), 4) end,
    coalesce(public.social_broker_account_mode(b.id), 'unknown'),
    (b.is_active = true and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')),
    eligibility.eligible, eligibility.reason, (s.is_synthetic = true or sp.is_synthetic_demo = true),
    public.social_source_eligibility_diagnostics(s.id)
  from public.social_copy_sources s
  join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
  join public.social_profiles sp on sp.user_id = s.trader_user_id and sp.is_listed = true
  cross join lateral public.social_source_performance_eligibility(s.id) eligibility
  where s.trader_user_id = p_trader_user_id and s.status = 'published'
    and (sp.access_mode = 'open' or s.trader_user_id = auth.uid() or exists (
      select 1 from public.social_follow_relationships r where r.follower_user_id = auth.uid()
        and r.followed_user_id = s.trader_user_id and r.status = 'accepted'))
  order by s.created_at, s.id;
$$;
revoke all on function public.get_social_copy_sources(uuid) from public, anon;
grant execute on function public.get_social_copy_sources(uuid) to authenticated;

create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'social_follow_accepted', 'social_copy_activated', 'social_copy_stopped', 'social_copy_suspended'
  )),
  event_key text not null,
  title text not null,
  body text not null,
  action_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);
create index in_app_notifications_user_created_idx on public.in_app_notifications (user_id, created_at desc);
alter table public.in_app_notifications enable row level security;
revoke all on table public.in_app_notifications from public, anon, authenticated;
grant select on table public.in_app_notifications to authenticated;
grant update (read_at) on table public.in_app_notifications to authenticated;
grant all on table public.in_app_notifications to service_role;
create policy users_read_own_in_app_notifications on public.in_app_notifications
  for select to authenticated using (user_id = auth.uid());
create policy users_mark_own_in_app_notifications_read on public.in_app_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.create_social_event_notification()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_error_code text; v_transition boolean;
begin
  if tg_table_name = 'social_follow_relationships' then
    if tg_op = 'INSERT' then v_transition := true;
    else v_transition := old.status is distinct from 'accepted';
    end if;
    if new.status = 'accepted' and v_transition then
      insert into public.in_app_notifications
        (user_id, actor_user_id, event_type, event_key, title, body, action_url, metadata)
      values (new.followed_user_id, new.follower_user_id, 'social_follow_accepted',
        'social-follow-accepted:' || new.id, 'New social follower',
        'A trader is now following your Social Trading profile.',
        '/social-trading/' || new.follower_user_id::text,
        jsonb_build_object('relationship_id', new.id))
      on conflict (user_id, event_key) do nothing;
    end if;
    return new;
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    insert into public.in_app_notifications
      (user_id, actor_user_id, event_type, event_key, title, body, action_url, metadata)
    values (new.source_trader_user_id, new.subscriber_user_id, 'social_copy_activated',
      'social-copy-activated:' || new.id, 'New copier activated',
      'A copy subscription to your published source is now active.',
      '/social-trading/' || new.subscriber_user_id::text,
      jsonb_build_object('subscription_id', new.id, 'source_id', new.source_id))
    on conflict (user_id, event_key) do nothing;
  elsif new.status in ('stopped', 'emergency_stopped') and old.status is distinct from new.status then
    insert into public.in_app_notifications
      (user_id, actor_user_id, event_type, event_key, title, body, action_url, metadata)
    values (new.source_trader_user_id, new.subscriber_user_id, 'social_copy_stopped',
      'social-copy-stopped:' || new.id, 'Copy subscription stopped',
      'A copier has stopped copying your published source.',
      '/social-trading/' || new.subscriber_user_id::text,
      jsonb_build_object('subscription_id', new.id, 'source_id', new.source_id))
    on conflict (user_id, event_key) do nothing;
  elsif new.status = 'error' and old.status is distinct from 'error' then
    v_error_code := coalesce(nullif(new.error_code, ''), 'unknown');
    insert into public.in_app_notifications
      (user_id, event_type, event_key, title, body, action_url, metadata)
    values (new.subscriber_user_id, 'social_copy_suspended',
      'social-copy-suspended:' || new.id || ':' || v_error_code,
      'Copy subscription needs attention',
      'Your copy subscription was suspended after reconciliation failed. Review its status before resuming.',
      '/social-trading/' || new.source_trader_user_id::text,
      jsonb_build_object('subscription_id', new.id, 'source_id', new.source_id, 'error_code', v_error_code))
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists social_follow_accepted_notification on public.social_follow_relationships;
create trigger social_follow_accepted_notification
after insert or update of status on public.social_follow_relationships
for each row execute function public.create_social_event_notification();

drop trigger if exists social_copy_status_notification on public.social_copy_subscriptions;
create trigger social_copy_status_notification
after update of status on public.social_copy_subscriptions
for each row execute function public.create_social_event_notification();

revoke all on function public.create_social_event_notification() from public, anon, authenticated;

-- The bell waits for realtime readiness; publication enables delivery where
-- Realtime is available, while refresh remains the fallback.
alter publication supabase_realtime add table public.in_app_notifications;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261028120000', '20261028120000_social_diagnostics_notifications', ARRAY['-- 20261028120000_social_diagnostics_notifications']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261029120000_social_verified_ticket_completeness.sql ==========
-- Keep unverified trade rows visible to integrity checks while limiting public
-- metrics and history to broker-verified identities.

-- Provider-aware canonical identity contract. MetaTrader bridges accept only
-- positive JavaScript-safe integers and collapse leading zeroes. Providers
-- whose native contract permits opaque strings retain their trimmed value.
-- Existing rows are deliberately not rewritten; reads/deduplication normalize
-- them so historical identities remain intact while new worker writes are canonical.
create or replace function public.social_normalize_trade_ticket(p_provider text, p_ticket text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select case
    when lower(coalesce(nullif(btrim(p_provider), ''), 'fxsocket')) in ('fxsocket', 'mtapi') then
      case when p_ticket ~ '^[0-9]+$'
             and p_ticket::numeric between 1 and 9007199254740991
        then (p_ticket::numeric)::text else null end
    when lower(btrim(p_provider)) in ('ctrader', 'binance', 'bybit', 'kucoin', 'dxtrade', 'tradelocker', 'matchtrader')
         and length(btrim(coalesce(p_ticket, ''))) between 1 and 255
         and btrim(p_ticket) !~ '[[:cntrl:]]'
      then btrim(p_ticket)
    else null
  end;
$$;

create or replace function public.social_trade_ticket_is_verified(p_provider text, p_ticket text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select public.social_normalize_trade_ticket(p_provider, p_ticket) is not null;
$$;

create or replace function public.social_trade_ticket_is_verified(p_ticket text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select public.social_trade_ticket_is_verified('fxsocket', p_ticket);
$$;

revoke all on function public.social_normalize_trade_ticket(text, text), public.social_trade_ticket_is_verified(text, text), public.social_trade_ticket_is_verified(text)
  from public, anon, authenticated;
grant execute on function public.social_normalize_trade_ticket(text, text), public.social_trade_ticket_is_verified(text, text), public.social_trade_ticket_is_verified(text)
  to service_role;

create or replace function public.social_source_trade_facts(p_source_id uuid)
returns table (
  open_count bigint,
  closed_count bigint,
  incomplete_count bigint,
  verified_closed_count bigint,
  period_start timestamptz,
  period_end timestamptz,
  realized_profit numeric,
  wins bigint,
  gross_profit numeric,
  gross_loss numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select s.broker_account_id
    from public.social_copy_sources s
    join public.broker_accounts b
      on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    where s.id = p_source_id
  ), scoped as (
    select distinct on (
      case when public.social_trade_ticket_is_verified(t.metaapi_order_id)
        then 'ticket:' || public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id) else 'row:' || t.id::text end
    )
      t.id,
      t.metaapi_order_id,
      lower(t.status) as status,
      t.opened_at,
      t.closed_at,
      t.profit,
      t.created_at
    from source_context sc
    join public.trades t on t.broker_account_id = sc.broker_account_id
    where (lower(t.status) = 'open'
       or t.closed_at is not null
       or lower(t.status) = 'closed')
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings mapping on mapping.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and mapping.destination_ticket is not null
          and mapping.destination_ticket = t.metaapi_order_id
      )
    order by
      case when public.social_trade_ticket_is_verified(t.metaapi_order_id)
        then 'ticket:' || public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id) else 'row:' || t.id::text end,
      t.created_at desc,
      t.id desc
  )
  select
    count(*) filter (
      where status = 'open' and closed_at is null
        and public.social_trade_ticket_is_verified(metaapi_order_id)
    ),
    count(*) filter (where status = 'closed' or closed_at is not null),
    count(*) filter (
      where not public.social_trade_ticket_is_verified(metaapi_order_id)
        or (
          (status = 'closed' or closed_at is not null)
          and (profit is null or closed_at is null)
        )
    ),
    count(*) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null
    ),
    min(opened_at) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null
    ),
    max(closed_at) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null
    ),
    sum(profit) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null
    ),
    count(*) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null and profit > 0
    ),
    sum(profit) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null and profit > 0
    ),
    abs(sum(profit) filter (
      where (status = 'closed' or closed_at is not null)
        and public.social_trade_ticket_is_verified(metaapi_order_id)
        and closed_at is not null
        and profit is not null and profit < 0
    ))
  from scoped;
$$;

revoke all on function public.social_source_trade_facts(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_trade_facts(uuid)
  to service_role;

create or replace function public.social_source_performance_eligibility(p_source_id uuid)
returns table (eligible boolean, reason text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select s.id, s.status, s.is_synthetic, sp.is_synthetic_demo,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    join public.broker_accounts b
      on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    join public.social_profiles sp on sp.user_id = s.trader_user_id
    where s.id = p_source_id
  ), evaluated as (
    select sc.*, f.*
    from (select 1) seed
    left join source_context sc on true
    left join lateral public.social_source_trade_facts(p_source_id) f on true
  )
  select
    case
      when id is null then false
      when status <> 'published' then false
      when (is_synthetic or is_synthetic_demo)
        and not public.social_copy_synthetic_participants_enabled() then false
      when provider not in ('fxsocket', 'mtapi') or platform not in ('MT4', 'MT5') then false
      when account_mode not in ('demo', 'live') then false
      when not is_active or connection_status not in ('connected', 'healthy') then false
      when last_synced_at is null or last_synced_at < now() - interval '15 minutes' then false
      when coalesce(incomplete_count, 0) > 0 then false
      when coalesce(verified_closed_count, 0) < 10 then false
      when period_start is null or period_end is null
        or period_end - period_start < interval '7 days' then false
      else true
    end,
    case
      when id is null then 'source_missing'
      when status <> 'published' then 'source_not_published'
      when (is_synthetic or is_synthetic_demo)
        and not public.social_copy_synthetic_participants_enabled() then 'synthetic_preview_disabled'
      when provider not in ('fxsocket', 'mtapi') or platform not in ('MT4', 'MT5') then 'source_unsupported'
      when account_mode not in ('demo', 'live') then 'account_mode_unknown'
      when not is_active then 'source_inactive'
      when connection_status = 'error' then 'sync_failed'
      when connection_status not in ('connected', 'healthy') then 'source_disconnected'
      when last_synced_at is null then 'sync_pending'
      when last_synced_at < now() - interval '15 minutes' then 'history_stale'
      when coalesce(incomplete_count, 0) > 0 then 'history_incomplete'
      when coalesce(verified_closed_count, 0) < 10 then 'minimum_trades_not_met'
      when period_start is null or period_end is null
        or period_end - period_start < interval '7 days' then 'minimum_period_not_met'
      else 'eligible'
    end
  from evaluated;
$$;

revoke all on function public.social_source_performance_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_performance_eligibility(uuid)
  to service_role;

comment on function public.social_source_performance_eligibility(uuid) is
  'Requires complete source history including unresolved closed rows and at least 10 verified closed trades spanning 7 days.';

create or replace function public.get_social_provider_performance(p_trader_user_id uuid)
returns table (
  source_id uuid,
  source_label text,
  source_status text,
  performance_status text,
  status_reason text,
  account_mode text,
  currency text,
  period_started_at timestamptz,
  period_ended_at timestamptz,
  last_sync_succeeded_at timestamptz,
  calculated_at timestamptz,
  history_complete boolean,
  open_trade_count bigint,
  closed_trade_count bigint,
  realized_profit numeric,
  win_rate numeric,
  profit_factor numeric,
  return_percentage numeric,
  maximum_drawdown numeric,
  equity_curve_available boolean,
  is_copy_eligible boolean,
  eligibility_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.social_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_profile
  from public.social_profiles
  where user_id = p_trader_user_id and is_listed = true;
  if not found then
    raise exception 'Social profile is not available' using errcode = 'P0002';
  end if;

  if v_actor <> p_trader_user_id and not (
    v_profile.share_trade_history
    and (
      v_profile.access_mode = 'open'
      or exists (
        select 1 from public.social_follow_relationships r
        where r.follower_user_id = v_actor
          and r.followed_user_id = p_trader_user_id
          and r.status = 'accepted'
      )
    )
  ) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;

  return query
  with source_context as (
    select s.id, coalesce(nullif(btrim(s.label), ''), 'Copy source') as label,
      s.status, s.broker_account_id,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as normalized_account_mode,
      b.last_currency, b.last_synced_at
    from public.social_copy_sources s
    left join public.broker_accounts b
      on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    where s.trader_user_id = p_trader_user_id
      and (s.status = 'published' or v_actor = p_trader_user_id)
  ), evaluated as (
    select sc.*, f.*,
      case
        when sc.broker_account_id is null then 'unavailable'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'unavailable'
        when sc.connection_status = 'error' then 'failed'
        when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then 'unavailable'
        when sc.last_synced_at is null then 'pending'
        when sc.last_synced_at < now() - interval '15 minutes' then 'stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'available'
      end as performance_state,
      case
        when sc.broker_account_id is null then 'source_account_missing'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
        when sc.connection_status = 'error' then 'sync_failed'
        when not sc.is_active then 'source_inactive'
        when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
        when sc.last_synced_at is null then 'sync_pending'
        when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'current'
      end as performance_reason
    from source_context sc
    cross join lateral public.social_source_trade_facts(sc.id) f
  )
  select
    e.id,
    e.label,
    e.status,
    e.performance_state,
    e.performance_reason,
    case when e.normalized_account_mode = 'demo' then 'demo'
         when e.normalized_account_mode = 'unknown' then 'unknown' else 'live' end,
    nullif(btrim(e.last_currency), ''),
    e.period_start,
    e.period_end,
    e.last_synced_at,
    statement_timestamp(),
    coalesce(e.closed_count, 0) > 0 and coalesce(e.incomplete_count, 0) = 0,
    e.open_count,
    e.closed_count,
    e.realized_profit,
    case when coalesce(e.verified_closed_count, 0) > 0
      then round((e.wins::numeric / e.verified_closed_count::numeric) * 100, 2)
      else null end,
    case when e.gross_loss > 0
      then round(coalesce(e.gross_profit, 0) / e.gross_loss, 4) else null end,
    null::numeric,
    null::numeric,
    false,
    eligibility.eligible,
    eligibility.reason
  from evaluated e
  cross join lateral public.social_source_performance_eligibility(e.id) eligibility
  order by (e.status = 'published') desc, e.label, e.id;
end;
$$;

revoke all on function public.get_social_provider_performance(uuid)
  from public, anon;
grant execute on function public.get_social_provider_performance(uuid)
  to authenticated;

create or replace function public.get_social_source_trade_history(
  p_source_id uuid,
  p_limit integer default 100
)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.social_copy_sources%rowtype;
  v_access record;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_source from public.social_copy_sources where id = p_source_id;
  if not found then raise exception 'Published source is not available' using errcode = 'P0002'; end if;

  select * into v_access
  from public.get_social_trade_history_access(v_source.trader_user_id);
  if not coalesce(v_access.can_view, false) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;
  if v_actor <> v_source.trader_user_id and v_source.status <> 'published' then
    raise exception 'Published source is not available' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = v_source.broker_account_id and b.user_id = v_source.trader_user_id
  ) then
    raise exception 'Source account is unavailable' using errcode = 'P0002';
  end if;

  return query
  with scoped as (
    select distinct on (public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id)) t.*
    from public.trades t
    where t.broker_account_id = v_source.broker_account_id
      and ((lower(t.status) = 'open' and t.closed_at is null) or t.closed_at is not null)
      and public.social_trade_ticket_is_verified(t.metaapi_order_id)
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings mapping on mapping.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and mapping.destination_ticket is not null
          and mapping.destination_ticket = t.metaapi_order_id
      )
    order by public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id), t.created_at desc, t.id desc
  )
  select s.id, s.symbol, lower(s.direction),
    case when s.closed_at is not null or lower(s.status) = 'closed' then 'closed' else 'open' end,
    s.opened_at, s.closed_at,
    case when s.closed_at is not null or lower(s.status) = 'closed' then s.profit else null end
  from scoped s
  order by coalesce(s.closed_at, s.opened_at) desc, s.id
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.get_social_source_trade_history(uuid, integer)
  from public, anon;
grant execute on function public.get_social_source_trade_history(uuid, integer)
  to authenticated;

create or replace function public.social_source_eligibility_diagnostics(p_source_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select s.id, s.status, s.broker_account_id, b.id as broker_record_id,
      s.is_synthetic, sp.is_synthetic_demo,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform, b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as account_mode,
      b.last_synced_at
    from public.social_copy_sources s
    left join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    left join public.social_profiles sp on sp.user_id = s.trader_user_id
    where s.id = p_source_id
  ), context as (
    select sc.*,
      coalesce(f.closed_count, 0) as closed_count,
      coalesce(f.incomplete_count, 0) as incomplete_count,
      coalesce(f.verified_closed_count, 0) as verified_closed_count,
      f.period_start, f.period_end
    from (select 1) seed
    left join source_context sc on true
    left join lateral public.social_source_trade_facts(p_source_id) f on true
  ), checks as (
    select v.*
    from context c
    cross join lateral (values
      (0, case when c.id is null or c.broker_record_id is null then 'source_missing' else 'source_present' end,
        case when c.id is null or c.broker_record_id is null then 'blocked' else 'passed' end,
        case when c.id is null or c.broker_record_id is null then 'error' else 'success' end,
        case when c.id is null or c.broker_record_id is null then 'The selected source account is unavailable.' else 'The source account exists and is owned by the publishing trader.' end,
        case when c.id is null or c.broker_record_id is null then 'Choose another owned source account or publish a new one.' else null end,
        c.id is null or c.broker_record_id is null),
      (1, case when c.status = 'published' then 'source_published' else 'source_not_published' end,
        case when c.status = 'published' then 'passed' else 'blocked' end,
        case when c.status = 'published' then 'success' else 'warning' end,
        case when c.status = 'published' then 'The trader explicitly published this source account.' else 'This source account has not been published for Social Trading.' end,
        case when c.status = 'published' then null else 'Publish this account from Social Trading settings.' end,
        c.status is distinct from 'published'),
      (2, case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'synthetic_preview_disabled' else 'synthetic_policy_passed' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'blocked' else 'passed' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'warning' else 'success' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'This synthetic demo source is restricted to an isolated preview environment.' else 'The source passes the preview-only synthetic participation policy.' end,
        case when (c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled() then 'Use Migration Preview with synthetic participation enabled, or select a genuine connected account.' else null end,
        coalesce((c.is_synthetic or c.is_synthetic_demo) and not public.social_copy_synthetic_participants_enabled(), false)),
      (3, case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'source_supported' else 'source_unsupported' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'passed' else 'blocked' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'success' else 'error' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then 'The source provider and platform are supported.' else 'This broker provider or platform is not supported for verified Social Trading performance.' end,
        case when c.provider in ('fxsocket', 'mtapi') and c.platform in ('MT4', 'MT5') then null else 'Connect a supported FxSocket or MTAPI MT4/MT5 account.' end,
        coalesce(c.provider not in ('fxsocket', 'mtapi') or c.platform not in ('MT4', 'MT5'), true)),
      (4, case when c.account_mode in ('demo', 'live') then 'account_mode_verified' else 'account_mode_unknown' end,
        case when c.account_mode in ('demo', 'live') then 'passed' else 'pending' end,
        case when c.account_mode in ('demo', 'live') then 'success' else 'info' end,
        case when c.account_mode in ('demo', 'live') then 'The broker verified whether this is a demo or live account.' else 'The account demo/live mode has not been verified yet.' end,
        case when c.account_mode in ('demo', 'live') then null else 'Reconnect or synchronize the account so its mode can be verified.' end,
        coalesce(c.account_mode not in ('demo', 'live'), true)),
      (5, case when c.is_active then 'source_active' else 'source_inactive' end,
        case when c.is_active then 'passed' else 'blocked' end,
        case when c.is_active then 'success' else 'error' end,
        case when c.is_active then 'The source account is active.' else 'The source account is inactive.' end,
        case when c.is_active then null else 'Activate the broker connection before using it as a source.' end,
        not coalesce(c.is_active, false)),
      (6, case when c.connection_status = 'error' then 'sync_failed' when c.connection_status not in ('connected', 'healthy') then 'source_disconnected' else 'source_connected' end,
        case when c.connection_status in ('connected', 'healthy') then 'passed' else 'blocked' end,
        case when c.connection_status in ('connected', 'healthy') then 'success' else 'error' end,
        case when c.connection_status = 'error' then 'The latest broker synchronization failed.' when c.connection_status not in ('connected', 'healthy') then 'The source account is disconnected from its broker.' else 'The source broker connection is healthy.' end,
        case when c.connection_status = 'error' then 'Repair or reconnect the broker account, then synchronize it again.' when c.connection_status not in ('connected', 'healthy') then 'Reconnect the source account and confirm that its connection is healthy.' else null end,
        coalesce(c.connection_status not in ('connected', 'healthy'), true)),
      (7, case when c.last_synced_at is null then 'sync_pending' when c.last_synced_at < now() - interval '15 minutes' then 'history_stale' else 'history_fresh' end,
        case when c.last_synced_at is null then 'pending' when c.last_synced_at < now() - interval '15 minutes' then 'blocked' else 'passed' end,
        case when c.last_synced_at is null then 'info' when c.last_synced_at < now() - interval '15 minutes' then 'error' else 'success' end,
        case when c.last_synced_at is null then 'The first successful source synchronization has not completed.' when c.last_synced_at < now() - interval '15 minutes' then 'The source history is older than the 15-minute freshness limit.' else 'The source history is within the 15-minute freshness limit.' end,
        case when c.last_synced_at is null then 'Keep the account connected and wait for synchronization to finish.' when c.last_synced_at < now() - interval '15 minutes' then 'Restore synchronization and wait for a fresh broker snapshot.' else null end,
        c.last_synced_at is null or c.last_synced_at < now() - interval '15 minutes'),
      (8, case when c.incomplete_count > 0 then 'history_incomplete' else 'history_complete' end,
        case when c.incomplete_count > 0 then 'blocked' else 'passed' end,
        case when c.incomplete_count > 0 then 'error' else 'success' end,
        case when c.incomplete_count > 0 then 'One or more source trades have an unverified broker ticket, or a closed trade is missing its close time or realized result.' else 'Every relevant source trade has a verified broker ticket, and every closed trade has a close time and realized result.' end,
        case when c.incomplete_count > 0 then 'Resolve or resynchronize every unresolved trade before publishing complete history.' else null end,
        c.incomplete_count > 0),
      (9, case when c.verified_closed_count < 10 then 'minimum_trades_not_met' else 'minimum_trades_met' end,
        case when c.verified_closed_count < 10 then 'pending' else 'passed' end,
        case when c.verified_closed_count < 10 then 'info' else 'success' end,
        case when c.verified_closed_count < 10 then 'Fewer than 10 closed trades with verified tickets and realized results are available.' else 'At least 10 closed trades with verified tickets and realized results are available.' end,
        case when c.verified_closed_count < 10 then 'Accumulate at least 10 verified closed trades and synchronize them.' else null end,
        c.verified_closed_count < 10),
      (10, case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'minimum_period_not_met' else 'minimum_period_met' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'pending' else 'passed' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'info' else 'success' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'The verified closed-trade history spans less than 7 days.' else 'The verified closed-trade history spans at least 7 days.' end,
        case when c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days' then 'Keep the account synchronized until its verified closed-trade history spans at least 7 days.' else null end,
        c.period_start is null or c.period_end is null or c.period_end - c.period_start < interval '7 days')
    ) as v(check_order, code, status, severity, explanation, next_action, blocking)
    where c.id is not null or v.check_order = 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order', check_order, 'code', code, 'status', status, 'severity', severity,
    'explanation', explanation, 'next_action', next_action, 'blocking', blocking
  ) order by check_order), '[]'::jsonb)
  from checks;
$$;

revoke all on function public.social_source_eligibility_diagnostics(uuid)
  from public, anon, authenticated;
grant execute on function public.social_source_eligibility_diagnostics(uuid)
  to service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261029120000', '20261029120000_social_verified_ticket_completeness', ARRAY['-- 20261029120000_social_verified_ticket_completeness']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101134804_provider_schema.sql ==========
/*
  Provider onboarding — schema (phase 0 + 1).

  - Telegram becomes an allowed public profile link.
  - social_profiles gains a stable public slug, a provider_status and a bio.
  - social_copy_sources gains an account snapshot (kind, platform, balance, equity,
    currency) that is refreshed server-side from broker_accounts.
  - provider_applications holds the onboarding draft and the admin review decision.
  - Existing providers (profiles that already own copy sources) are grandfathered
    as approved so nothing disappears from the directory.
*/

-- 1. Public profile links: add Telegram -------------------------------------------------
create or replace function public.social_profile_links_are_valid(p_links jsonb)
returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(coalesce(p_links, '{}'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_each(coalesce(p_links, '{}'::jsonb)) entry
      where entry.key not in ('x', 'instagram', 'telegram', 'linkedin', 'youtube', 'tiktok', 'facebook')
        or jsonb_typeof(entry.value) <> 'string'
        or length(entry.value #>> '{}') > 500
        or not (
          (entry.key = 'x' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)/[^[:space:]]+$')
          or (entry.key = 'instagram' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*instagram\.com/[^[:space:]]+$')
          or (entry.key = 'telegram' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*(t\.me|telegram\.me|telegram\.org)/[^[:space:]]+$')
          or (entry.key = 'linkedin' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*linkedin\.com/[^[:space:]]+$')
          or (entry.key = 'youtube' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/[^[:space:]]+$')
          or (entry.key = 'tiktok' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*tiktok\.com/[^[:space:]]+$')
          or (entry.key = 'facebook' and (entry.value #>> '{}') ~* '^https://([a-z0-9-]+\.)*facebook\.com/[^[:space:]]+$')
        )
    );
$$;

-- 2. social_profiles: slug, provider status, bio ---------------------------------------
alter table public.social_profiles
  add column if not exists slug text,
  add column if not exists provider_status text not null default 'none',
  add column if not exists bio text;

alter table public.social_profiles drop constraint if exists social_profiles_provider_status_check;
alter table public.social_profiles add constraint social_profiles_provider_status_check
  check (provider_status in ('none', 'pending', 'approved', 'rejected', 'suspended'));

alter table public.social_profiles drop constraint if exists social_profiles_bio_length;
alter table public.social_profiles add constraint social_profiles_bio_length
  check (bio is null or char_length(bio) <= 500);

create or replace function public.social_generate_slug(p_user_id uuid)
returns text
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 0;
begin
  select lower(regexp_replace(
    coalesce(nullif(btrim(up.username), ''), nullif(btrim(up.display_name), ''), ''),
    '[^a-zA-Z0-9]+', '-', 'g'))
  into v_base
  from public.user_profiles up
  where up.user_id = p_user_id;

  v_base := btrim(coalesce(v_base, ''), '-');
  v_base := btrim(left(v_base, 32), '-');
  if char_length(v_base) < 3 then
    v_base := 'trader-' || substr(replace(p_user_id::text, '-', ''), 1, 6);
  end if;

  v_candidate := v_base;
  while exists (
    select 1 from public.social_profiles sp where sp.slug = v_candidate and sp.user_id <> p_user_id
  ) loop
    v_n := v_n + 1;
    v_candidate := left(v_base, 30) || '-' || v_n::text;
  end loop;
  return v_candidate;
end;
$$;

create or replace function public.social_profiles_assign_slug()
returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.slug is null then
    new.slug := public.social_generate_slug(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists social_profiles_assign_slug on public.social_profiles;
create trigger social_profiles_assign_slug
  before insert on public.social_profiles
  for each row execute function public.social_profiles_assign_slug();

update public.social_profiles sp
set slug = public.social_generate_slug(sp.user_id)
where sp.slug is null;

alter table public.social_profiles alter column slug set not null;
alter table public.social_profiles drop constraint if exists social_profiles_slug_format;
alter table public.social_profiles add constraint social_profiles_slug_format
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
create unique index if not exists social_profiles_slug_key on public.social_profiles (slug);

-- Grandfather every existing provider: profiles that already own a copy source.
update public.social_profiles sp
set provider_status = 'approved'
where sp.provider_status = 'none'
  and exists (select 1 from public.social_copy_sources s where s.trader_user_id = sp.user_id);

-- 3. social_copy_sources: account snapshot ---------------------------------------------
alter table public.social_copy_sources
  add column if not exists account_kind text,
  add column if not exists platform text,
  add column if not exists snapshot_balance numeric,
  add column if not exists snapshot_equity numeric,
  add column if not exists snapshot_currency text,
  add column if not exists snapshot_at timestamptz;

alter table public.social_copy_sources drop constraint if exists social_copy_sources_account_kind_check;
alter table public.social_copy_sources add constraint social_copy_sources_account_kind_check
  check (account_kind is null or account_kind in ('demo', 'live', 'prop', 'unknown'));

-- 4. provider_applications --------------------------------------------------------------
create table if not exists public.provider_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  broker_account_id uuid references public.broker_accounts(id) on delete set null,
  declared_account_kind text check (declared_account_kind is null or declared_account_kind in ('demo', 'live', 'prop')),
  prop_firm_name text check (prop_firm_name is null or char_length(prop_firm_name) between 2 and 80),
  monthly_price_cents integer check (monthly_price_cents is null or monthly_price_cents between 0 and 10000000),
  access_mode text not null default 'open' check (access_mode in ('open', 'private')),
  bio text check (bio is null or char_length(bio) <= 500),
  social_links jsonb not null default '{}'::jsonb check (public.social_profile_links_are_valid(social_links)),
  terms_accepted_at timestamptz,
  submit_count integer not null default 0,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_applications_status_idx
  on public.provider_applications (status, submitted_at);

alter table public.provider_applications enable row level security;

drop policy if exists provider_applications_owner_select on public.provider_applications;
create policy provider_applications_owner_select on public.provider_applications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists provider_applications_admin_select on public.provider_applications;
create policy provider_applications_admin_select on public.provider_applications
  for select to authenticated using (public.is_admin());

-- Writes only happen through security-definer RPCs; there are no insert/update/delete policies.
revoke all on public.provider_applications from anon, authenticated;
grant select on public.provider_applications to authenticated;

comment on table public.provider_applications is
  'Provider onboarding drafts and admin review decisions. Mutated only through save_provider_draft / submit_provider_application / admin_review_provider_application.';

-- 5. Notification event types for the review outcome ----------------------------------
alter table public.in_app_notifications drop constraint if exists in_app_notifications_event_type_check;
alter table public.in_app_notifications add constraint in_app_notifications_event_type_check
  check (event_type in (
    'social_follow_accepted', 'social_copy_activated', 'social_copy_stopped', 'social_copy_suspended',
    'provider_application_approved', 'provider_application_rejected',
    'provider_suspended', 'provider_reinstated'
  ));

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101134804', '20261101134804_provider_schema', ARRAY['-- 20261101134804_provider_schema']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101135057_provider_rpcs.sql ==========
/*
  Provider onboarding — RPCs (phase 1).

  save_provider_draft / get_my_provider_application / submit_provider_application
  admin_review_provider_application (approve | reject | suspend | reinstate)
  update_provider_profile (approved providers edit price / access / bio / links)
  refresh_social_source_snapshot (+ cron every 5 min)
  get_provider_public_profile (anon-readable public profile by slug)
  get_social_directory extended with slug, provider status, bio and account snapshot
  publish_social_copy_source now requires an approved provider
*/

-- Helpers ------------------------------------------------------------------------------
create or replace function public.provider_account_ineligibility(p_user_id uuid, p_broker_account_id uuid)
returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_broker_account_id is null then return 'account_missing'; end if;
  if not exists (
    select 1 from public.broker_accounts b where b.id = p_broker_account_id and b.user_id = p_user_id
  ) then return 'account_not_owned'; end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = p_broker_account_id and b.user_id = p_user_id
      and b.is_active = true
      and lower(coalesce(b.connection_status, '')) in ('connected', 'healthy')
  ) then return 'account_not_connected'; end if;
  if not exists (
    select 1 from public.broker_accounts b
    where b.id = p_broker_account_id
      and lower(coalesce(nullif(b.provider, ''), 'fxsocket')) in ('fxsocket', 'mtapi')
      and upper(coalesce(b.platform, '')) in ('MT4', 'MT5')
  ) then return 'platform_unsupported'; end if;
  if public.social_broker_account_mode(p_broker_account_id) not in ('demo', 'live') then
    return 'mode_unverified';
  end if;
  return null;
end;
$$;

create or replace function public.provider_notify(
  p_user_id uuid, p_actor uuid, p_event_type text, p_title text, p_body text, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into public.in_app_notifications
    (user_id, actor_user_id, event_type, event_key, title, body, action_url, metadata)
  values (
    p_user_id, p_actor, p_event_type,
    p_event_type || ':' || gen_random_uuid()::text,
    p_title, p_body, '/social-trading/provider', coalesce(p_metadata, '{}'::jsonb)
  )
$$;

create or replace function public.provider_audit(
  p_target uuid, p_action text, p_reason text, p_before jsonb, p_after jsonb
) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into public.admin_audit_logs
    (actor_user_id, target_user_id, action, entity_type, entity_id, reason, before_state, after_state)
  values (auth.uid(), p_target, p_action, 'provider_application', p_target::text, p_reason, p_before, p_after)
$$;

revoke all on function public.provider_account_ineligibility(uuid, uuid) from public, anon, authenticated;
revoke all on function public.provider_notify(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.provider_audit(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Snapshot refresh ----------------------------------------------------------------------
create or replace function public.refresh_social_source_snapshots_internal(p_source_id uuid default null)
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  update public.social_copy_sources s
  set account_kind = case
        when exists (
          select 1 from public.provider_applications pa
          where pa.user_id = s.trader_user_id
            and pa.broker_account_id = s.broker_account_id
            and pa.declared_account_kind = 'prop'
            and pa.status in ('approved', 'suspended')
        ) then 'prop'
        else public.social_broker_account_mode(s.broker_account_id)
      end,
      platform = upper(nullif(btrim(b.platform), '')),
      snapshot_balance = b.last_balance,
      snapshot_equity = b.last_equity,
      snapshot_currency = upper(nullif(btrim(b.last_currency), '')),
      snapshot_at = b.last_synced_at
  from public.broker_accounts b
  where b.id = s.broker_account_id
    and (p_source_id is null or s.id = p_source_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.refresh_social_source_snapshots_internal(uuid) from public, anon, authenticated;

create or replace function public.refresh_social_source_snapshot(p_source_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.social_copy_sources s where s.id = p_source_id and s.trader_user_id = v_actor
  ) and not public.is_admin() then
    raise exception 'Copy source was not found' using errcode = 'P0002';
  end if;
  perform public.refresh_social_source_snapshots_internal(p_source_id);
end;
$$;
revoke all on function public.refresh_social_source_snapshot(uuid) from public, anon;
grant execute on function public.refresh_social_source_snapshot(uuid) to authenticated;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'refresh-social-source-snapshots';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;
select cron.schedule(
  'refresh-social-source-snapshots', '*/5 * * * *',
  $$select public.refresh_social_source_snapshots_internal(null)$$
);

-- Draft ---------------------------------------------------------------------------------
create or replace function public.save_provider_draft(
  p_broker_account_id uuid default null,
  p_declared_account_kind text default null,
  p_prop_firm_name text default null,
  p_monthly_price_cents integer default null,
  p_access_mode text default 'open',
  p_bio text default null,
  p_social_links jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_kind text := nullif(btrim(p_declared_account_kind), '');
  v_firm text := nullif(btrim(p_prop_firm_name), '');
  v_bio text := nullif(btrim(p_bio), '');
  v_links jsonb := coalesce(p_social_links, '{}'::jsonb);
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Becoming a provider requires a verified account' using errcode = '42501';
  end if;
  if v_kind is not null and v_kind not in ('demo', 'live', 'prop') then
    raise exception 'Invalid account type' using errcode = '22023';
  end if;
  if p_access_mode not in ('open', 'private') then
    raise exception 'Invalid access mode' using errcode = '22023';
  end if;
  if p_monthly_price_cents is not null and p_monthly_price_cents not between 0 and 10000000 then
    raise exception 'Invalid price' using errcode = '22023';
  end if;
  if v_bio is not null and char_length(v_bio) > 500 then
    raise exception 'Bio is too long' using errcode = '22023';
  end if;
  if not public.social_profile_links_are_valid(v_links) then
    raise exception 'Invalid social profile links' using errcode = '22023';
  end if;
  if p_broker_account_id is not null and not exists (
    select 1 from public.broker_accounts b where b.id = p_broker_account_id and b.user_id = v_actor
  ) then
    raise exception 'Broker account is not owned by the current user' using errcode = '42501';
  end if;
  if v_kind is distinct from 'prop' then v_firm := null; end if;

  select status into v_status from public.provider_applications where user_id = v_actor for update;
  if v_status = 'pending' then
    raise exception 'Your application is under review' using errcode = '55000';
  elsif v_status in ('approved', 'suspended') then
    raise exception 'Provider applications that were already reviewed cannot be redrafted' using errcode = '55000';
  end if;

  insert into public.provider_applications as pa
    (user_id, status, broker_account_id, declared_account_kind, prop_firm_name,
     monthly_price_cents, access_mode, bio, social_links)
  values (v_actor, 'draft', p_broker_account_id, v_kind, v_firm,
          p_monthly_price_cents, p_access_mode, v_bio, v_links)
  on conflict (user_id) do update set
    status = 'draft',
    broker_account_id = excluded.broker_account_id,
    declared_account_kind = excluded.declared_account_kind,
    prop_firm_name = excluded.prop_firm_name,
    monthly_price_cents = excluded.monthly_price_cents,
    access_mode = excluded.access_mode,
    bio = excluded.bio,
    social_links = excluded.social_links,
    updated_at = now();
end;
$$;

create or replace function public.get_my_provider_application()
returns table (
  status text, broker_account_id uuid, declared_account_kind text, prop_firm_name text,
  monthly_price_cents integer, access_mode text, bio text, social_links jsonb,
  terms_accepted_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz,
  rejection_reason text, slug text, updated_at timestamptz
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select pa.status, pa.broker_account_id, pa.declared_account_kind, pa.prop_firm_name,
         pa.monthly_price_cents, pa.access_mode, pa.bio, pa.social_links,
         pa.terms_accepted_at, pa.submitted_at, pa.reviewed_at, pa.rejection_reason,
         sp.slug, pa.updated_at
  from public.provider_applications pa
  left join public.social_profiles sp on sp.user_id = pa.user_id
  where pa.user_id = v_actor;
end;
$$;

-- Submit --------------------------------------------------------------------------------
create or replace function public.submit_provider_application(p_accept_terms boolean default false)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor uuid := auth.uid();
  v_app public.provider_applications;
  v_problem text;
  v_mode text;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Becoming a provider requires a verified account' using errcode = '42501';
  end if;
  if p_accept_terms is not true then
    raise exception 'You must accept the provider terms' using errcode = '22023';
  end if;

  select * into v_app from public.provider_applications where user_id = v_actor for update;
  if not found then raise exception 'Save your application before submitting' using errcode = 'P0002'; end if;
  if v_app.status not in ('draft', 'rejected') then
    raise exception 'This application cannot be submitted in its current state' using errcode = '55000';
  end if;
  if v_app.submit_count >= 10 then
    raise exception 'Too many submissions; contact support' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.user_profiles up
    where up.user_id = v_actor
      and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  ) then
    raise exception 'Add a display name or username to your profile first' using errcode = '55000';
  end if;

  v_problem := public.provider_account_ineligibility(v_actor, v_app.broker_account_id);
  if v_problem is not null then
    raise exception 'Selected account is not eligible (%)', v_problem using errcode = '55000';
  end if;
  if v_app.declared_account_kind is null then
    raise exception 'Select the account type' using errcode = '22023';
  end if;
  if v_app.declared_account_kind = 'prop' and v_app.prop_firm_name is null then
    raise exception 'Enter the prop firm name' using errcode = '22023';
  end if;
  v_mode := public.social_broker_account_mode(v_app.broker_account_id);
  if v_app.declared_account_kind in ('demo', 'live') and v_app.declared_account_kind <> v_mode then
    raise exception 'Declared account type does not match the connected account' using errcode = '22023';
  end if;
  if v_app.monthly_price_cents is null then
    raise exception 'Set a price (0 for free)' using errcode = '22023';
  end if;

  update public.provider_applications
  set status = 'pending', submitted_at = now(), terms_accepted_at = now(),
      submit_count = submit_count + 1, rejection_reason = null,
      reviewed_by = null, reviewed_at = null, updated_at = now()
  where user_id = v_actor;

  insert into public.social_profiles (user_id, is_listed, provider_status)
  values (v_actor, false, 'pending')
  on conflict (user_id) do update set provider_status = 'pending';
end;
$$;

-- Admin review --------------------------------------------------------------------------
create or replace function public.admin_review_provider_application(
  p_user_id uuid, p_decision text, p_reason text default null, p_account_kind text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_admin uuid := auth.uid();
  v_app public.provider_applications;
  v_before jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_kind text;
  v_problem text;
  v_source_id uuid;
  v_name text;
begin
  if v_admin is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject', 'suspend', 'reinstate') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;

  select * into v_app from public.provider_applications where user_id = p_user_id for update;
  if not found then raise exception 'Application was not found' using errcode = 'P0002'; end if;
  v_before := to_jsonb(v_app) - 'social_links';

  select coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), ''), 'Trader')
  into v_name from public.user_profiles up where up.user_id = p_user_id;

  if p_decision = 'approve' or p_decision = 'reinstate' then
    if p_decision = 'approve' and v_app.status <> 'pending' then
      raise exception 'Only pending applications can be approved' using errcode = '55000';
    end if;
    if p_decision = 'reinstate' and v_app.status <> 'suspended' then
      raise exception 'Only suspended providers can be reinstated' using errcode = '55000';
    end if;
    v_problem := public.provider_account_ineligibility(p_user_id, v_app.broker_account_id);
    if v_problem is not null then
      raise exception 'Selected account is not eligible (%)', v_problem using errcode = '55000';
    end if;
    v_kind := coalesce(nullif(btrim(p_account_kind), ''), v_app.declared_account_kind);
    if v_kind not in ('demo', 'live', 'prop') then
      raise exception 'Invalid account type' using errcode = '22023';
    end if;

    update public.provider_applications
    set status = 'approved', declared_account_kind = v_kind, reviewed_by = v_admin,
        reviewed_at = now(), rejection_reason = null, updated_at = now()
    where user_id = p_user_id;

    insert into public.social_profiles
      (user_id, is_listed, access_mode, monthly_copy_price_cents, bio, provider_status)
    values (p_user_id, true, v_app.access_mode, v_app.monthly_price_cents, v_app.bio, 'approved')
    on conflict (user_id) do update set
      is_listed = true, access_mode = excluded.access_mode,
      monthly_copy_price_cents = excluded.monthly_copy_price_cents,
      bio = excluded.bio, provider_status = 'approved';

    update public.user_profiles
    set social_links = v_app.social_links, updated_at = now()
    where user_id = p_user_id;

    insert into public.social_copy_sources (trader_user_id, broker_account_id, status)
    values (p_user_id, v_app.broker_account_id, 'published')
    on conflict (broker_account_id) do update set status = 'published', updated_at = now()
    where public.social_copy_sources.trader_user_id = p_user_id
    returning id into v_source_id;
    if v_source_id is null then
      raise exception 'Copy source belongs to another trader' using errcode = '42501';
    end if;
    perform public.refresh_social_source_snapshots_internal(v_source_id);

    perform public.provider_notify(
      p_user_id, v_admin,
      case when p_decision = 'approve' then 'provider_application_approved' else 'provider_reinstated' end,
      case when p_decision = 'approve' then 'Your provider application was approved'
           else 'Your provider profile was reinstated' end,
      'Your profile is live in the Social Trading directory and your account can now be copied.',
      jsonb_build_object('decision', p_decision)
    );

  elsif p_decision = 'reject' then
    if v_app.status <> 'pending' then
      raise exception 'Only pending applications can be rejected' using errcode = '55000';
    end if;
    if v_reason is null then
      raise exception 'A rejection reason is required' using errcode = '22023';
    end if;
    update public.provider_applications
    set status = 'rejected', rejection_reason = left(v_reason, 1000),
        reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where user_id = p_user_id;
    update public.social_profiles set provider_status = 'rejected' where user_id = p_user_id;
    perform public.provider_notify(
      p_user_id, v_admin, 'provider_application_rejected',
      'Your provider application needs changes', left(v_reason, 500),
      jsonb_build_object('decision', 'reject')
    );

  else -- suspend
    if v_app.status <> 'approved' then
      raise exception 'Only approved providers can be suspended' using errcode = '55000';
    end if;
    update public.provider_applications
    set status = 'suspended', rejection_reason = v_reason,
        reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where user_id = p_user_id;
    update public.social_profiles
    set provider_status = 'suspended', is_listed = false
    where user_id = p_user_id;
    update public.social_copy_sources
    set status = 'paused', updated_at = now()
    where trader_user_id = p_user_id and status = 'published';
    update public.social_copy_subscriptions sub
    set desired_status = 'paused', updated_at = now()
    where sub.source_id in (select id from public.social_copy_sources where trader_user_id = p_user_id)
      and sub.status not in ('stopped', 'emergency_stopped')
      and sub.desired_status <> 'stopped';
    perform public.provider_notify(
      p_user_id, v_admin, 'provider_suspended',
      'Your provider profile was suspended',
      coalesce(left(v_reason, 500), 'Your provider profile was paused by an administrator.'),
      jsonb_build_object('decision', 'suspend')
    );
  end if;

  perform public.provider_audit(
    p_user_id, 'provider_application.' || p_decision, v_reason, v_before,
    (select to_jsonb(pa) - 'social_links' from public.provider_applications pa where pa.user_id = p_user_id)
  );

  return jsonb_build_object('user_id', p_user_id, 'name', v_name, 'decision', p_decision);
end;
$$;

-- Approved providers: edit price / access / bio / links ---------------------------------
create or replace function public.update_provider_profile(
  p_monthly_price_cents integer, p_access_mode text, p_bio text, p_social_links jsonb
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor uuid := auth.uid();
  v_links jsonb := coalesce(p_social_links, '{}'::jsonb);
  v_bio text := nullif(btrim(p_bio), '');
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.social_profiles where user_id = v_actor and provider_status = 'approved'
  ) then raise exception 'Only approved providers can edit a provider profile' using errcode = '42501'; end if;
  if p_monthly_price_cents is null or p_monthly_price_cents not between 0 and 10000000 then
    raise exception 'Invalid price' using errcode = '22023';
  end if;
  if p_access_mode not in ('open', 'private') then
    raise exception 'Invalid access mode' using errcode = '22023';
  end if;
  if v_bio is not null and char_length(v_bio) > 500 then
    raise exception 'Bio is too long' using errcode = '22023';
  end if;
  if not public.social_profile_links_are_valid(v_links) then
    raise exception 'Invalid social profile links' using errcode = '22023';
  end if;

  update public.social_profiles
  set monthly_copy_price_cents = p_monthly_price_cents, access_mode = p_access_mode, bio = v_bio
  where user_id = v_actor;
  update public.user_profiles set social_links = v_links, updated_at = now() where user_id = v_actor;
  update public.provider_applications
  set monthly_price_cents = p_monthly_price_cents, access_mode = p_access_mode,
      bio = v_bio, social_links = v_links, updated_at = now()
  where user_id = v_actor;
end;
$$;

-- Publishing requires an approved provider ---------------------------------------------
create or replace function public.publish_social_copy_source(p_broker_account_id uuid, p_label text default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.social_follow_actor_is_verified(v_actor) then
    raise exception 'Social copy source publishing requires a verified account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.social_profiles sp where sp.user_id = v_actor and sp.provider_status = 'approved'
  ) then
    raise exception 'Your provider application must be approved before publishing a copy source'
      using errcode = '55000';
  end if;
  if not public.social_follow_profile_is_eligible(v_actor) then
    raise exception 'Join the social directory before publishing a copy source' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.broker_accounts b where b.id = p_broker_account_id and b.user_id = v_actor
  ) then
    raise exception 'Broker account is not owned by the current user' using errcode = '42501';
  end if;
  if public.provider_account_ineligibility(v_actor, p_broker_account_id) is not null then
    raise exception 'Broker account is not connected, supported, or mode-verified for Social Trading'
      using errcode = '55000';
  end if;

  insert into public.social_copy_sources (trader_user_id, broker_account_id, status, label)
  values (v_actor, p_broker_account_id, 'published', nullif(btrim(p_label), ''))
  on conflict (broker_account_id) do update set
    status = 'published', label = excluded.label, updated_at = now()
  where public.social_copy_sources.trader_user_id = v_actor
  returning id into v_id;
  if v_id is null then raise exception 'Copy source belongs to another trader' using errcode = '42501'; end if;
  perform public.refresh_social_source_snapshots_internal(v_id);
  return v_id;
end;
$$;

-- Directory -----------------------------------------------------------------------------
drop function if exists public.get_social_directory();
create function public.get_social_directory()
returns table (
  profile_user_id uuid, display_name text, username text, country text,
  access_mode text, is_self boolean, follower_count bigint, following_count bigint,
  viewer_relationship_status text, follows_viewer_status text, average_rating numeric,
  review_count bigint, viewer_rating smallint, shares_trade_history boolean,
  created_at timestamptz, monthly_copy_price_cents integer, is_synthetic_demo boolean,
  social_links jsonb,
  slug text, provider_status text, bio text,
  account_kind text, platform text, balance numeric, equity numeric, currency text, snapshot_at timestamptz
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select sp.user_id,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')),
    coalesce(nullif(btrim(up.username), ''), ''), coalesce(nullif(btrim(up.country), ''), ''),
    sp.access_mode, sp.user_id = v_actor,
    (select count(*) from public.social_follow_relationships incoming
      join public.social_profiles ip on ip.user_id = incoming.follower_user_id
      join public.user_profiles ii on ii.user_id = incoming.follower_user_id
      where incoming.followed_user_id = sp.user_id and incoming.status = 'accepted'
        and ip.is_listed = true
        and coalesce(nullif(btrim(ii.display_name), ''), nullif(btrim(ii.username), '')) is not null),
    (select count(*) from public.social_follow_relationships outgoing_count
      join public.social_profiles fp on fp.user_id = outgoing_count.followed_user_id
      join public.user_profiles fi on fi.user_id = outgoing_count.followed_user_id
      where outgoing_count.follower_user_id = sp.user_id and outgoing_count.status = 'accepted'
        and fp.is_listed = true
        and coalesce(nullif(btrim(fi.display_name), ''), nullif(btrim(fi.username), '')) is not null),
    outgoing.status, incoming_viewer.status,
    (select round(avg(r.rating)::numeric, 2) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select count(*) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select r.rating from public.social_trader_reviews r where r.trader_user_id = sp.user_id and r.reviewer_user_id = v_actor),
    sp.share_trade_history, sp.created_at, sp.monthly_copy_price_cents,
    sp.is_synthetic_demo, coalesce(up.social_links, '{}'::jsonb),
    sp.slug, sp.provider_status, sp.bio,
    src.account_kind, src.platform, src.snapshot_balance, src.snapshot_equity,
    src.snapshot_currency, src.snapshot_at
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join public.social_follow_relationships outgoing
    on outgoing.follower_user_id = v_actor and outgoing.followed_user_id = sp.user_id
  left join public.social_follow_relationships incoming_viewer
    on incoming_viewer.follower_user_id = sp.user_id and incoming_viewer.followed_user_id = v_actor
  left join lateral (
    select s.account_kind, s.platform, s.snapshot_balance, s.snapshot_equity, s.snapshot_currency, s.snapshot_at
    from public.social_copy_sources s
    where s.trader_user_id = sp.user_id and s.status = 'published'
    order by s.created_at asc
    limit 1
  ) src on true
  where sp.is_listed = true
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
  order by 7 desc, 2 asc, 1 asc;
end;
$$;

-- Public profile (anon readable) ---------------------------------------------------------
create or replace function public.get_provider_public_profile(p_slug text)
returns table (
  profile_user_id uuid, slug text, display_name text, username text, country text, bio text,
  access_mode text, follower_count bigint, average_rating numeric, review_count bigint,
  monthly_copy_price_cents integer, social_links jsonb,
  account_kind text, platform text, balance numeric, equity numeric, currency text,
  snapshot_at timestamptz, joined_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select sp.user_id, sp.slug,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')),
    coalesce(nullif(btrim(up.username), ''), ''), coalesce(nullif(btrim(up.country), ''), ''),
    sp.bio, sp.access_mode,
    (select count(*) from public.social_follow_relationships f
      where f.followed_user_id = sp.user_id and f.status = 'accepted'),
    (select round(avg(r.rating)::numeric, 2) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    (select count(*) from public.social_trader_reviews r where r.trader_user_id = sp.user_id),
    sp.monthly_copy_price_cents, coalesce(up.social_links, '{}'::jsonb),
    src.account_kind, src.platform, src.snapshot_balance, src.snapshot_equity,
    src.snapshot_currency, src.snapshot_at, sp.created_at
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join lateral (
    select s.account_kind, s.platform, s.snapshot_balance, s.snapshot_equity, s.snapshot_currency, s.snapshot_at
    from public.social_copy_sources s
    where s.trader_user_id = sp.user_id and s.status = 'published'
    order by s.created_at asc
    limit 1
  ) src on true
  where sp.slug = lower(btrim(p_slug))
    and sp.is_listed = true
    and sp.provider_status = 'approved'
    and sp.is_synthetic_demo = false
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
$$;

-- Grants --------------------------------------------------------------------------------
revoke all on function public.save_provider_draft(uuid, text, text, integer, text, text, jsonb) from public, anon;
revoke all on function public.get_my_provider_application() from public, anon;
revoke all on function public.submit_provider_application(boolean) from public, anon;
revoke all on function public.admin_review_provider_application(uuid, text, text, text) from public, anon;
revoke all on function public.update_provider_profile(integer, text, text, jsonb) from public, anon;
revoke all on function public.publish_social_copy_source(uuid, text) from public, anon;
revoke all on function public.get_social_directory() from public, anon;
revoke all on function public.get_provider_public_profile(text) from public;
grant execute on function public.save_provider_draft(uuid, text, text, integer, text, text, jsonb) to authenticated;
grant execute on function public.get_my_provider_application() to authenticated;
grant execute on function public.submit_provider_application(boolean) to authenticated;
grant execute on function public.admin_review_provider_application(uuid, text, text, text) to authenticated;
grant execute on function public.update_provider_profile(integer, text, text, jsonb) to authenticated;
grant execute on function public.publish_social_copy_source(uuid, text) to authenticated;
grant execute on function public.get_social_directory() to authenticated;
grant execute on function public.get_provider_public_profile(text) to anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101135057', '20261101135057_provider_rpcs', ARRAY['-- 20261101135057_provider_rpcs']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101135535_provider_admin_list.sql ==========
/*
  Provider onboarding — admin review queue listing.
  Admin-only; used by the backoffice "Provider applications" page.
*/
create or replace function public.admin_list_provider_applications(p_status text default null)
returns table (
  user_id uuid, display_name text, username text, email text,
  status text, submitted_at timestamptz, reviewed_at timestamptz, rejection_reason text, submit_count integer,
  declared_account_kind text, detected_account_mode text, prop_firm_name text,
  monthly_price_cents integer, access_mode text, bio text, social_links jsonb,
  account_label text, platform text, account_login text, connection_status text,
  balance numeric, equity numeric, currency text, synced_at timestamptz,
  eligibility text
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('draft', 'pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Invalid status filter' using errcode = '22023';
  end if;
  return query
  select pa.user_id,
    coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')),
    coalesce(nullif(btrim(up.username), ''), ''), au.email::text,
    pa.status, pa.submitted_at, pa.reviewed_at, pa.rejection_reason, pa.submit_count,
    pa.declared_account_kind, public.social_broker_account_mode(pa.broker_account_id), pa.prop_firm_name,
    pa.monthly_price_cents, pa.access_mode, pa.bio, pa.social_links,
    coalesce(nullif(btrim(b.label), ''), nullif(btrim(b.broker_name), '')), upper(b.platform),
    b.account_login::text, b.connection_status,
    b.last_balance, b.last_equity, upper(nullif(btrim(b.last_currency), '')), b.last_synced_at,
    public.provider_account_ineligibility(pa.user_id, pa.broker_account_id)
  from public.provider_applications pa
  left join public.user_profiles up on up.user_id = pa.user_id
  left join auth.users au on au.id = pa.user_id
  left join public.broker_accounts b on b.id = pa.broker_account_id
  where pa.status <> 'draft'
    and (p_status is null or pa.status = p_status)
  order by case pa.status when 'pending' then 0 else 1 end,
    coalesce(pa.submitted_at, pa.updated_at) asc;
end;
$$;

revoke all on function public.admin_list_provider_applications(text) from public, anon;
grant execute on function public.admin_list_provider_applications(text) to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101135535', '20261101135535_provider_admin_list', ARRAY['-- 20261101135535_provider_admin_list']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101140031_provider_backfill.sql ==========
/*
  Provider onboarding — grandfather existing providers.

  Profiles that already owned a published copy source before the application flow
  existed were marked approved by 20261101134804_provider_schema. Give each of them
  an approved application row (so they can edit their profile through
  update_provider_profile and cannot re-apply) and fill the account snapshot.
*/
select public.refresh_social_source_snapshots_internal(null);

insert into public.provider_applications
  (user_id, status, broker_account_id, declared_account_kind, monthly_price_cents,
   access_mode, bio, social_links, terms_accepted_at, submit_count, submitted_at,
   reviewed_at, created_at, updated_at)
select sp.user_id, 'approved', src.broker_account_id,
       case when src.account_kind in ('demo', 'live', 'prop') then src.account_kind else null end,
       coalesce(sp.monthly_copy_price_cents, 0), sp.access_mode, sp.bio,
       coalesce(up.social_links, '{}'::jsonb), now(), 0, null, now(), now(), now()
from public.social_profiles sp
join public.user_profiles up on up.user_id = sp.user_id
join lateral (
  select s.broker_account_id, s.account_kind
  from public.social_copy_sources s
  where s.trader_user_id = sp.user_id
  order by (s.status = 'published') desc, s.created_at asc
  limit 1
) src on true
where sp.provider_status = 'approved'
  and not exists (select 1 from public.provider_applications pa where pa.user_id = sp.user_id);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101140031', '20261101140031_provider_backfill', ARRAY['-- 20261101140031_provider_backfill']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101144153_provider_public_performance.sql ==========
-- Public (anon-readable) performance + trade history for approved providers' shareable /p/{slug} page.
-- Gate: provider approved + listed + not synthetic + social_profiles.share_trade_history = true.
-- Without the share toggle the performance function returns a single row with shared = false and no metrics.

-- Internal helper: verified, de-duplicated source-account trades (same scope as the signed-in history RPC).
create or replace function public.provider_public_source_trades(p_source_id uuid)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_context as (
    select s.broker_account_id
    from public.social_copy_sources s
    join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    where s.id = p_source_id and s.status = 'published'
  ), scoped as (
    select distinct on (public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id)) t.*
    from source_context sc
    join public.trades t on t.broker_account_id = sc.broker_account_id
    where ((lower(t.status) = 'open' and t.closed_at is null) or t.closed_at is not null)
      and public.social_trade_ticket_is_verified(t.metaapi_order_id)
      and not exists (
        select 1
        from public.social_copy_subscriptions sub
        join public.social_copy_trade_mappings mapping on mapping.subscription_id = sub.id
        where sub.destination_broker_account_id = t.broker_account_id
          and mapping.destination_ticket is not null
          and mapping.destination_ticket = t.metaapi_order_id
      )
    order by public.social_normalize_trade_ticket('fxsocket', t.metaapi_order_id), t.created_at desc, t.id desc
  )
  select s.id, s.symbol, lower(s.direction),
    case when s.closed_at is not null or lower(s.status) = 'closed' then 'closed' else 'open' end,
    s.opened_at, s.closed_at,
    case when s.closed_at is not null or lower(s.status) = 'closed' then s.profit else null end
  from scoped s;
$$;

-- Internal helper: resolve the public, shared source for a slug (null row when not public).
create or replace function public.provider_public_shared_source(p_slug text)
returns table (source_id uuid, trader_user_id uuid, shared boolean, broker_account_id uuid, currency text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select src.id, sp.user_id, sp.share_trade_history, src.broker_account_id, src.snapshot_currency
  from public.social_profiles sp
  join public.user_profiles up on up.user_id = sp.user_id
  left join lateral (
    select s.id, s.broker_account_id, s.snapshot_currency
    from public.social_copy_sources s
    where s.trader_user_id = sp.user_id and s.status = 'published'
    order by s.created_at asc
    limit 1
  ) src on true
  where sp.slug = lower(btrim(p_slug))
    and sp.is_listed = true
    and sp.provider_status = 'approved'
    and sp.is_synthetic_demo = false
    and coalesce(nullif(btrim(up.display_name), ''), nullif(btrim(up.username), '')) is not null
$$;

create or replace function public.get_provider_public_performance(p_slug text)
returns table (
  shared boolean,
  currency text,
  last_synced_at timestamptz,
  history_complete boolean,
  open_count bigint,
  closed_count bigint,
  wins bigint,
  win_rate numeric,
  profit_factor numeric,
  realized_profit numeric,
  gross_profit numeric,
  gross_loss numeric,
  best_profit numeric,
  best_at timestamptz,
  worst_profit numeric,
  worst_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  monthly jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_src record;
  v_facts record;
  v_synced timestamptz;
  v_best record;
  v_worst record;
  v_monthly jsonb;
begin
  select * into v_src from public.provider_public_shared_source(p_slug);
  if not found then return; end if;

  if not coalesce(v_src.shared, false) or v_src.source_id is null then
    return query select false, v_src.currency, null::timestamptz, null::boolean,
      null::bigint, null::bigint, null::bigint, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::timestamptz, null::numeric, null::timestamptz,
      null::timestamptz, null::timestamptz, null::jsonb;
    return;
  end if;

  select * into v_facts from public.social_source_trade_facts(v_src.source_id);
  select b.last_synced_at into v_synced from public.broker_accounts b where b.id = v_src.broker_account_id;

  select t.realized_profit as profit, t.closed_at as at into v_best
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit desc, t.closed_at desc limit 1;

  select t.realized_profit as profit, t.closed_at as at into v_worst
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit asc, t.closed_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'profit', m.profit, 'trades', m.trades) order by m.month), '[]'::jsonb)
  into v_monthly
  from (
    select to_char(date_trunc('month', t.closed_at at time zone 'UTC'), 'YYYY-MM') as month,
      round(sum(t.realized_profit), 2) as profit, count(*) as trades
    from public.provider_public_source_trades(v_src.source_id) t
    where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
    group by 1
  ) m;

  return query select true, v_src.currency, v_synced,
    (coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null),
    coalesce(v_facts.open_count, 0), coalesce(v_facts.closed_count, 0), coalesce(v_facts.wins, 0),
    case when coalesce(v_facts.verified_closed_count, 0) > 0
      then round((v_facts.wins::numeric / v_facts.verified_closed_count::numeric) * 100, 2) end,
    case when coalesce(v_facts.gross_loss, 0) > 0 then round(v_facts.gross_profit / v_facts.gross_loss, 2) end,
    v_facts.realized_profit, v_facts.gross_profit, v_facts.gross_loss,
    v_best.profit, v_best.at, v_worst.profit, v_worst.at,
    v_facts.period_start, v_facts.period_end, v_monthly;
end;
$$;

create or replace function public.get_provider_public_trade_history(p_slug text, p_limit integer default 100)
returns table (
  trade_id uuid,
  symbol text,
  direction text,
  trade_status text,
  opened_at timestamptz,
  closed_at timestamptz,
  realized_profit numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_src record;
begin
  select * into v_src from public.provider_public_shared_source(p_slug);
  if not found or not coalesce(v_src.shared, false) or v_src.source_id is null then return; end if;
  return query
  select t.trade_id, t.symbol, t.direction, t.trade_status, t.opened_at, t.closed_at, t.realized_profit
  from public.provider_public_source_trades(v_src.source_id) t
  order by coalesce(t.closed_at, t.opened_at) desc, t.trade_id
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.provider_public_source_trades(uuid) from public, anon, authenticated;
revoke all on function public.provider_public_shared_source(text) from public, anon, authenticated;
revoke all on function public.get_provider_public_performance(text) from public;
revoke all on function public.get_provider_public_trade_history(text, integer) from public;
grant execute on function public.get_provider_public_performance(text) to anon, authenticated;
grant execute on function public.get_provider_public_trade_history(text, integer) to anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101144153', '20261101144153_provider_public_performance', ARRAY['-- 20261101144153_provider_public_performance']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101155142_provider_cashflow_totals.sql ==========
-- Account deposit / withdrawal totals, written only by server code (edge function, service role),
-- read by the account owner and (when the provider shares trade history) by the public profile.

alter table public.broker_accounts
  add column if not exists total_deposits numeric,
  add column if not exists total_withdrawals numeric,
  add column if not exists cashflow_synced_at timestamptz;

-- Clients may update their own broker row, so keep these server-derived columns tamper-proof.
create or replace function public.broker_accounts_protect_cashflow_totals()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.total_deposits := null;
      new.total_withdrawals := null;
      new.cashflow_synced_at := null;
    else
      new.total_deposits := old.total_deposits;
      new.total_withdrawals := old.total_withdrawals;
      new.cashflow_synced_at := old.cashflow_synced_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists broker_accounts_protect_cashflow_totals on public.broker_accounts;
create trigger broker_accounts_protect_cashflow_totals
  before insert or update on public.broker_accounts
  for each row execute function public.broker_accounts_protect_cashflow_totals();

grant select (total_deposits, total_withdrawals, cashflow_synced_at) on public.broker_accounts to authenticated;

-- Public performance now also exposes deposits (broker history total, else the saved starting balance).
drop function if exists public.get_provider_public_performance(text);
create or replace function public.get_provider_public_performance(p_slug text)
returns table (
  shared boolean,
  currency text,
  last_synced_at timestamptz,
  history_complete boolean,
  open_count bigint,
  closed_count bigint,
  wins bigint,
  win_rate numeric,
  profit_factor numeric,
  realized_profit numeric,
  gross_profit numeric,
  gross_loss numeric,
  best_profit numeric,
  best_at timestamptz,
  worst_profit numeric,
  worst_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  monthly jsonb,
  deposits numeric,
  withdrawals numeric,
  deposit_source text,
  cashflow_synced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_src record;
  v_facts record;
  v_synced timestamptz;
  v_best record;
  v_worst record;
  v_monthly jsonb;
  v_cash record;
begin
  select * into v_src from public.provider_public_shared_source(p_slug);
  if not found then return; end if;

  if not coalesce(v_src.shared, false) or v_src.source_id is null then
    return query select false, v_src.currency, null::timestamptz, null::boolean,
      null::bigint, null::bigint, null::bigint, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::timestamptz, null::numeric, null::timestamptz,
      null::timestamptz, null::timestamptz, null::jsonb,
      null::numeric, null::numeric, null::text, null::timestamptz;
    return;
  end if;

  select * into v_facts from public.social_source_trade_facts(v_src.source_id);
  select b.total_deposits, b.total_withdrawals, b.cashflow_synced_at, b.performance_baseline_balance
  into v_cash from public.broker_accounts b where b.id = v_src.broker_account_id;
  select b.last_synced_at into v_synced from public.broker_accounts b where b.id = v_src.broker_account_id;

  select t.realized_profit as profit, t.closed_at as at into v_best
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit desc, t.closed_at desc limit 1;

  select t.realized_profit as profit, t.closed_at as at into v_worst
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit asc, t.closed_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'profit', m.profit, 'trades', m.trades) order by m.month), '[]'::jsonb)
  into v_monthly
  from (
    select to_char(date_trunc('month', t.closed_at at time zone 'UTC'), 'YYYY-MM') as month,
      round(sum(t.realized_profit), 2) as profit, count(*) as trades
    from public.provider_public_source_trades(v_src.source_id) t
    where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
    group by 1
  ) m;

  return query select true, v_src.currency, v_synced,
    (coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null),
    coalesce(v_facts.open_count, 0), coalesce(v_facts.closed_count, 0), coalesce(v_facts.wins, 0),
    case when coalesce(v_facts.verified_closed_count, 0) > 0
      then round((v_facts.wins::numeric / v_facts.verified_closed_count::numeric) * 100, 2) end,
    case when coalesce(v_facts.gross_loss, 0) > 0 then round(v_facts.gross_profit / v_facts.gross_loss, 2) end,
    v_facts.realized_profit, v_facts.gross_profit, v_facts.gross_loss,
    v_best.profit, v_best.at, v_worst.profit, v_worst.at,
    v_facts.period_start, v_facts.period_end, v_monthly,
    coalesce(v_cash.total_deposits, v_cash.performance_baseline_balance),
    v_cash.total_withdrawals,
    case when v_cash.total_deposits is not null then 'broker_history'
         when v_cash.performance_baseline_balance is not null then 'starting_balance' end,
    v_cash.cashflow_synced_at;
end;
$$;


revoke all on function public.get_provider_public_performance(text) from public;
grant execute on function public.get_provider_public_performance(text) to anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101155142', '20261101155142_provider_cashflow_totals', ARRAY['-- 20261101155142_provider_cashflow_totals']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101160309_broker_account_leverage.sql ==========
-- Account leverage (e.g. 500 means 1:500) as reported by the broker summary; written by the
-- broker edge functions on each summary refresh. Display only.
alter table public.broker_accounts
  add column if not exists account_leverage integer;

comment on column public.broker_accounts.account_leverage is
  'Account leverage reported by the broker (500 = 1:500). Written by broker edge functions on summary refresh.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101160309', '20261101160309_broker_account_leverage', ARRAY['-- 20261101160309_broker_account_leverage']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101162956_broker_account_leverage_grant.sql ==========
-- broker_accounts is readable through column-level grants; the app selects account_leverage
-- (brokerAccountSelect.ts), so authenticated users need SELECT on it or the whole query fails.
grant select (account_leverage) on public.broker_accounts to authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101162956', '20261101162956_broker_account_leverage_grant', ARRAY['-- 20261101162956_broker_account_leverage_grant']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101164328_provider_public_max_drawdown.sql ==========
-- Public performance now also reports max drawdown (%), computed server-side from the realized-balance curve.
drop function if exists public.get_provider_public_performance(text);
create or replace function public.get_provider_public_performance(p_slug text)
returns table (
  shared boolean,
  currency text,
  last_synced_at timestamptz,
  history_complete boolean,
  open_count bigint,
  closed_count bigint,
  wins bigint,
  win_rate numeric,
  profit_factor numeric,
  realized_profit numeric,
  gross_profit numeric,
  gross_loss numeric,
  best_profit numeric,
  best_at timestamptz,
  worst_profit numeric,
  worst_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  monthly jsonb,
  deposits numeric,
  withdrawals numeric,
  deposit_source text,
  cashflow_synced_at timestamptz,
  max_drawdown numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_src record;
  v_facts record;
  v_synced timestamptz;
  v_best record;
  v_worst record;
  v_monthly jsonb;
  v_cash record;
  v_dd numeric;
begin
  select * into v_src from public.provider_public_shared_source(p_slug);
  if not found then return; end if;

  if not coalesce(v_src.shared, false) or v_src.source_id is null then
    return query select false, v_src.currency, null::timestamptz, null::boolean,
      null::bigint, null::bigint, null::bigint, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::timestamptz, null::numeric, null::timestamptz,
      null::timestamptz, null::timestamptz, null::jsonb,
      null::numeric, null::numeric, null::text, null::timestamptz, null::numeric;
    return;
  end if;

  select * into v_facts from public.social_source_trade_facts(v_src.source_id);
  select b.total_deposits, b.total_withdrawals, b.cashflow_synced_at, b.performance_baseline_balance
  into v_cash from public.broker_accounts b where b.id = v_src.broker_account_id;
  select b.last_synced_at into v_synced from public.broker_accounts b where b.id = v_src.broker_account_id;

  select t.realized_profit as profit, t.closed_at as at into v_best
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit desc, t.closed_at desc limit 1;

  select t.realized_profit as profit, t.closed_at as at into v_worst
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit asc, t.closed_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'profit', m.profit, 'trades', m.trades) order by m.month), '[]'::jsonb)
  into v_monthly
  from (
    select to_char(date_trunc('month', t.closed_at at time zone 'UTC'), 'YYYY-MM') as month,
      round(sum(t.realized_profit), 2) as profit, count(*) as trades
    from public.provider_public_source_trades(v_src.source_id) t
    where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
    group by 1
  ) m;

  -- Max drawdown (%): worst peak-to-trough decline of the realized-balance curve, starting from the
  -- performance baseline balance (deposits excluded). Same method as the in-app account analytics.
  -- Only reported for a complete, synced history with a known baseline.
  if coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null
     and coalesce(v_cash.performance_baseline_balance, 0) > 0 then
    select coalesce(max(case when c.peak > 0 then (c.peak - c.curve) / c.peak * 100 else 0 end), 0)
    into v_dd
    from (
      select
        v_cash.performance_baseline_balance + x.cum as curve,
        greatest(
          v_cash.performance_baseline_balance,
          max(v_cash.performance_baseline_balance + x.cum) over (
            order by x.closed_at, x.trade_id rows between unbounded preceding and current row
          )
        ) as peak
      from (
        select t.trade_id, t.closed_at,
          sum(t.realized_profit) over (order by t.closed_at, t.trade_id) as cum
        from public.provider_public_source_trades(v_src.source_id) t
        where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
      ) x
    ) c;
  end if;

  return query select true, v_src.currency, v_synced,
    (coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null),
    coalesce(v_facts.open_count, 0), coalesce(v_facts.closed_count, 0), coalesce(v_facts.wins, 0),
    case when coalesce(v_facts.verified_closed_count, 0) > 0
      then round((v_facts.wins::numeric / v_facts.verified_closed_count::numeric) * 100, 2) end,
    case when coalesce(v_facts.gross_loss, 0) > 0 then round(v_facts.gross_profit / v_facts.gross_loss, 2) end,
    v_facts.realized_profit, v_facts.gross_profit, v_facts.gross_loss,
    v_best.profit, v_best.at, v_worst.profit, v_worst.at,
    v_facts.period_start, v_facts.period_end, v_monthly,
    coalesce(v_cash.total_deposits, v_cash.performance_baseline_balance),
    v_cash.total_withdrawals,
    case when v_cash.total_deposits is not null then 'broker_history'
         when v_cash.performance_baseline_balance is not null then 'starting_balance' end,
    v_cash.cashflow_synced_at,
    round(v_dd, 2);
end;
$$;


revoke all on function public.get_provider_public_performance(text) from public;
grant execute on function public.get_provider_public_performance(text) to anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101164328', '20261101164328_provider_public_max_drawdown', ARRAY['-- 20261101164328_provider_public_max_drawdown']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;


-- ========== 20261101164716_social_return_metrics.sql ==========
-- ROI and max drawdown, computed server-side from the realized-balance curve (same method as the account analytics).

-- Realized-balance return metrics for a published source: ROI (% of the performance baseline balance)
-- and max drawdown (%, worst peak-to-trough decline of the realized-balance curve). Deposits and
-- withdrawals are excluded. Internal helper for the security-definer performance RPCs.
create or replace function public.social_source_return_metrics(p_source_id uuid)
returns table (return_percentage numeric, max_drawdown numeric)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with ctx as (
    select b.performance_baseline_balance as baseline
    from public.social_copy_sources s
    join public.broker_accounts b on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    where s.id = p_source_id
  ), closed as (
    select t.trade_id, t.closed_at, t.realized_profit
    from public.provider_public_source_trades(p_source_id) t
    where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  ), running as (
    select c.trade_id, c.closed_at, c.realized_profit, ctx.baseline,
      ctx.baseline + sum(c.realized_profit) over (order by c.closed_at, c.trade_id) as bal
    from closed c cross join ctx
  ), peaks as (
    select r.*, greatest(r.baseline, max(r.bal) over (order by r.closed_at, r.trade_id rows between unbounded preceding and current row)) as peak
    from running r
  )
  select
    case when min(baseline) > 0 and count(*) > 0 then round(sum(realized_profit) / min(baseline) * 100, 2) end,
    case when min(baseline) > 0 and count(*) > 0
      then round(coalesce(max(case when peak > 0 then (peak - bal) / peak * 100 else 0 end), 0), 2) end
  from peaks;
$$;

revoke all on function public.social_source_return_metrics(uuid) from public, anon, authenticated;

create or replace function public.get_social_provider_performance(p_trader_user_id uuid)
returns table (
  source_id uuid,
  source_label text,
  source_status text,
  performance_status text,
  status_reason text,
  account_mode text,
  currency text,
  period_started_at timestamptz,
  period_ended_at timestamptz,
  last_sync_succeeded_at timestamptz,
  calculated_at timestamptz,
  history_complete boolean,
  open_trade_count bigint,
  closed_trade_count bigint,
  realized_profit numeric,
  win_rate numeric,
  profit_factor numeric,
  return_percentage numeric,
  maximum_drawdown numeric,
  equity_curve_available boolean,
  is_copy_eligible boolean,
  eligibility_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.social_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_profile
  from public.social_profiles
  where user_id = p_trader_user_id and is_listed = true;
  if not found then
    raise exception 'Social profile is not available' using errcode = 'P0002';
  end if;

  if v_actor <> p_trader_user_id and not (
    v_profile.share_trade_history
    and (
      v_profile.access_mode = 'open'
      or exists (
        select 1 from public.social_follow_relationships r
        where r.follower_user_id = v_actor
          and r.followed_user_id = p_trader_user_id
          and r.status = 'accepted'
      )
    )
  ) then
    raise exception 'Trader has not shared trade history with this viewer' using errcode = '42501';
  end if;

  return query
  with source_context as (
    select s.id, coalesce(nullif(btrim(s.label), ''), 'Copy source') as label,
      s.status, s.broker_account_id,
      lower(coalesce(nullif(b.provider, ''), 'fxsocket')) as provider,
      upper(coalesce(b.platform, '')) as platform,
      b.is_active,
      lower(coalesce(b.connection_status, '')) as connection_status,
      coalesce(public.social_broker_account_mode(b.id), 'unknown') as normalized_account_mode,
      b.last_currency, b.last_synced_at
    from public.social_copy_sources s
    left join public.broker_accounts b
      on b.id = s.broker_account_id and b.user_id = s.trader_user_id
    where s.trader_user_id = p_trader_user_id
      and (s.status = 'published' or v_actor = p_trader_user_id)
  ), evaluated as (
    select sc.*, f.*,
      case
        when sc.broker_account_id is null then 'unavailable'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'unavailable'
        when sc.connection_status = 'error' then 'failed'
        when not sc.is_active or sc.connection_status not in ('connected', 'healthy') then 'unavailable'
        when sc.last_synced_at is null then 'pending'
        when sc.last_synced_at < now() - interval '15 minutes' then 'stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'available'
      end as performance_state,
      case
        when sc.broker_account_id is null then 'source_account_missing'
        when sc.provider not in ('fxsocket', 'mtapi') or sc.platform not in ('MT4', 'MT5') then 'source_unsupported'
        when sc.connection_status = 'error' then 'sync_failed'
        when not sc.is_active then 'source_inactive'
        when sc.connection_status not in ('connected', 'healthy') then 'source_disconnected'
        when sc.last_synced_at is null then 'sync_pending'
        when sc.last_synced_at < now() - interval '15 minutes' then 'history_stale'
        when coalesce(f.incomplete_count, 0) > 0 then 'history_incomplete'
        when coalesce(f.open_count, 0) + coalesce(f.closed_count, 0) = 0 then 'no_history'
        else 'current'
      end as performance_reason
    from source_context sc
    cross join lateral public.social_source_trade_facts(sc.id) f
  )
  select
    e.id,
    e.label,
    e.status,
    e.performance_state,
    e.performance_reason,
    case when e.normalized_account_mode = 'demo' then 'demo'
         when e.normalized_account_mode = 'unknown' then 'unknown' else 'live' end,
    nullif(btrim(e.last_currency), ''),
    e.period_start,
    e.period_end,
    e.last_synced_at,
    statement_timestamp(),
    coalesce(e.closed_count, 0) > 0 and coalesce(e.incomplete_count, 0) = 0,
    e.open_count,
    e.closed_count,
    e.realized_profit,
    case when coalesce(e.verified_closed_count, 0) > 0
      then round((e.wins::numeric / e.verified_closed_count::numeric) * 100, 2)
      else null end,
    case when e.gross_loss > 0
      then round(coalesce(e.gross_profit, 0) / e.gross_loss, 4) else null end,
    case when coalesce(e.closed_count, 0) > 0 and coalesce(e.incomplete_count, 0) = 0 then rm.return_percentage end,
    case when coalesce(e.closed_count, 0) > 0 and coalesce(e.incomplete_count, 0) = 0 then rm.max_drawdown end,
    false,
    eligibility.eligible,
    eligibility.reason
  from evaluated e
  cross join lateral public.social_source_performance_eligibility(e.id) eligibility
  cross join lateral public.social_source_return_metrics(e.id) rm
  order by (e.status = 'published') desc, e.label, e.id;
end;
$$;

revoke all on function public.get_social_provider_performance(uuid)
  from public, anon;
grant execute on function public.get_social_provider_performance(uuid)
  to authenticated;

drop function if exists public.get_provider_public_performance(text);
create or replace function public.get_provider_public_performance(p_slug text)
returns table (
  shared boolean,
  currency text,
  last_synced_at timestamptz,
  history_complete boolean,
  open_count bigint,
  closed_count bigint,
  wins bigint,
  win_rate numeric,
  profit_factor numeric,
  realized_profit numeric,
  gross_profit numeric,
  gross_loss numeric,
  best_profit numeric,
  best_at timestamptz,
  worst_profit numeric,
  worst_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  monthly jsonb,
  deposits numeric,
  withdrawals numeric,
  deposit_source text,
  cashflow_synced_at timestamptz,
  max_drawdown numeric,
  return_percentage numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_src record;
  v_facts record;
  v_synced timestamptz;
  v_best record;
  v_worst record;
  v_monthly jsonb;
  v_cash record;
  v_dd numeric;
  v_roi numeric;
begin
  select * into v_src from public.provider_public_shared_source(p_slug);
  if not found then return; end if;

  if not coalesce(v_src.shared, false) or v_src.source_id is null then
    return query select false, v_src.currency, null::timestamptz, null::boolean,
      null::bigint, null::bigint, null::bigint, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::timestamptz, null::numeric, null::timestamptz,
      null::timestamptz, null::timestamptz, null::jsonb,
      null::numeric, null::numeric, null::text, null::timestamptz, null::numeric, null::numeric;
    return;
  end if;

  select * into v_facts from public.social_source_trade_facts(v_src.source_id);
  select b.total_deposits, b.total_withdrawals, b.cashflow_synced_at, b.performance_baseline_balance
  into v_cash from public.broker_accounts b where b.id = v_src.broker_account_id;
  select b.last_synced_at into v_synced from public.broker_accounts b where b.id = v_src.broker_account_id;

  select t.realized_profit as profit, t.closed_at as at into v_best
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit desc, t.closed_at desc limit 1;

  select t.realized_profit as profit, t.closed_at as at into v_worst
  from public.provider_public_source_trades(v_src.source_id) t
  where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
  order by t.realized_profit asc, t.closed_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'profit', m.profit, 'trades', m.trades) order by m.month), '[]'::jsonb)
  into v_monthly
  from (
    select to_char(date_trunc('month', t.closed_at at time zone 'UTC'), 'YYYY-MM') as month,
      round(sum(t.realized_profit), 2) as profit, count(*) as trades
    from public.provider_public_source_trades(v_src.source_id) t
    where t.trade_status = 'closed' and t.realized_profit is not null and t.closed_at is not null
    group by 1
  ) m;

  -- ROI and max drawdown from the realized-balance curve; only for a complete, synced history.
  if coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null then
    select rm.return_percentage, rm.max_drawdown into v_roi, v_dd
    from public.social_source_return_metrics(v_src.source_id) rm;
  end if;

  return query select true, v_src.currency, v_synced,
    (coalesce(v_facts.incomplete_count, 0) = 0 and v_synced is not null),
    coalesce(v_facts.open_count, 0), coalesce(v_facts.closed_count, 0), coalesce(v_facts.wins, 0),
    case when coalesce(v_facts.verified_closed_count, 0) > 0
      then round((v_facts.wins::numeric / v_facts.verified_closed_count::numeric) * 100, 2) end,
    case when coalesce(v_facts.gross_loss, 0) > 0 then round(v_facts.gross_profit / v_facts.gross_loss, 2) end,
    v_facts.realized_profit, v_facts.gross_profit, v_facts.gross_loss,
    v_best.profit, v_best.at, v_worst.profit, v_worst.at,
    v_facts.period_start, v_facts.period_end, v_monthly,
    coalesce(v_cash.total_deposits, v_cash.performance_baseline_balance),
    v_cash.total_withdrawals,
    case when v_cash.total_deposits is not null then 'broker_history'
         when v_cash.performance_baseline_balance is not null then 'starting_balance' end,
    v_cash.cashflow_synced_at,
    v_dd,
    v_roi;
end;
$$;


revoke all on function public.get_provider_public_performance(text) from public;
grant execute on function public.get_provider_public_performance(text) to anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20261101164716', '20261101164716_social_return_metrics', ARRAY['-- 20261101164716_social_return_metrics']::text[], 'opencode-controlled-apply')
ON CONFLICT (version) DO NOTHING;
