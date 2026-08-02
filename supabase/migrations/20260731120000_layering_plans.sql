-- Phase C immutable Static/Dynamic layering-plan persistence.
-- Additive only: plans are stored separately from active range_pending_legs so
-- current monitors cannot execute Static/Dynamic rows before Phase D.

create table if not exists public.layering_plans (
  layer_plan_id text primary key,
  signal_id uuid not null,
  broker_account_id uuid not null,
  basket_key text not null default '',
  mode text not null check (mode in ('static', 'dynamic')),
  status text not null default 'prepared'
    check (status in ('prepared', 'activating', 'active', 'entries_complete', 'completed', 'cancelling', 'cancellation_pending', 'cancellation_manual_review', 'cancelled', 'invalid')),
  layer_plan_metadata jsonb not null,
  semantic_fingerprint text not null,
  first_execution_trade_id uuid,
  first_execution_order_id text,
  first_execution_status text,
  first_execution_fill_price numeric,
  first_execution_filled_lot numeric,
  first_execution_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz not null,
  activated_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  cancellation_reason text,
  constraint layering_plans_id_safe_chk
    check (layer_plan_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint layering_plans_metadata_object_chk
    check (jsonb_typeof(layer_plan_metadata) = 'object')
);

comment on table public.layering_plans is
  'Immutable prepared Static/Dynamic range-layering plans. Phase C stores non-executable plans only; Phase D may activate/materialize funded legs.';

comment on column public.layering_plans.layer_plan_metadata is
  'Versioned LayeringPlanSnapshot JSON. Unknown versions must fail closed in worker parsing.';

comment on column public.layering_plans.semantic_fingerprint is
  'Worker-computed semantic fingerprint over immutable plan content; excludes lifecycle timestamps for retry idempotency.';

alter table public.layering_plans enable row level security;

-- Worker/service-role only. Phase C exposes no client read/write path for plan
-- metadata; service_role is used by worker-side persistence and future guarded
-- status transitions.
revoke all on table public.layering_plans from anon, authenticated;
grant select, insert, update, delete on table public.layering_plans to service_role;

create unique index if not exists layering_plans_identity_idx
  on public.layering_plans(signal_id, broker_account_id, basket_key, mode);

create index if not exists layering_plans_signal_broker_idx
  on public.layering_plans(signal_id, broker_account_id);

create index if not exists layering_plans_prepared_idx
  on public.layering_plans(status)
  where status = 'prepared';

create unique index if not exists range_pending_legs_layer_plan_step_idx
  on public.range_pending_legs(layer_plan_id, step_idx)
  where layer_plan_id is not null;

comment on index public.range_pending_legs_layer_plan_step_idx is
  'Prevents duplicate materialized Static/Dynamic plan legs for one immutable plan.';

alter table public.range_pending_legs
  add column if not exists broker_client_reference text,
  add column if not exists broker_pending_type text,
  add column if not exists native_submission_status text,
  add column if not exists submission_claimed_at timestamptz,
  add column if not exists submission_claimed_by text,
  add column if not exists submission_attempt int not null default 0,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists broker_pending_reason text,
  add column if not exists reconciliation_reason text,
  add column if not exists reconciliation_claimed_at timestamptz,
  add column if not exists reconciliation_claimed_by text,
  add column if not exists cancellation_status text,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_confirmed_at timestamptz,
  add column if not exists cancellation_reason text;

comment on column public.range_pending_legs.broker_client_reference is
  'Deterministic Static/Dynamic broker-native pending reference derived from layer_plan_id and step_idx; nullable for Legacy and virtual rows.';

create unique index if not exists range_pending_legs_broker_client_ref_idx
  on public.range_pending_legs(broker_account_id, broker_client_reference)
  where broker_client_reference is not null;

comment on index public.range_pending_legs_broker_client_ref_idx is
  'Prevents duplicate Static/Dynamic native pending-order references per broker account.';

create or replace function public.layering_settings_guard_fragment(p_settings jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'layering_mode', coalesce(p_settings->'layering_mode', '"legacy"'::jsonb),
    'range_layering_type', coalesce(p_settings->'range_layering_type', '"auto"'::jsonb),
    'static_layer_count', coalesce(p_settings->'static_layer_count', '5'::jsonb),
    'dynamic_step_pips', coalesce(p_settings->'dynamic_step_pips', '3'::jsonb),
    'dynamic_max_layers', coalesce(p_settings->'dynamic_max_layers', '5'::jsonb)
  );
$$;

create or replace function public.layering_channel_configs_guard_fragment(p_configs jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(
      entry.key,
      public.layering_settings_guard_fragment(coalesce(entry.value->'manual_settings', '{}'::jsonb))
      order by entry.key
    ),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(p_configs, '{}'::jsonb)) as entry(key, value);
$$;

create or replace function public.prevent_client_layering_settings_bypass()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT'
       and public.layering_settings_guard_fragment('{}'::jsonb)
         is distinct from public.layering_settings_guard_fragment(coalesce(new.manual_settings, '{}'::jsonb)) then
      raise exception 'layering settings require authoritative endpoint';
    end if;
    if tg_op = 'UPDATE'
       and public.layering_settings_guard_fragment(coalesce(old.manual_settings, '{}'::jsonb))
         is distinct from public.layering_settings_guard_fragment(coalesce(new.manual_settings, '{}'::jsonb)) then
      raise exception 'layering settings require authoritative endpoint';
    end if;
    if tg_table_name = 'broker_accounts' and tg_op = 'INSERT'
       and public.layering_channel_configs_guard_fragment('{}'::jsonb)
         is distinct from public.layering_channel_configs_guard_fragment(coalesce(new.channel_trading_configs, '{}'::jsonb)) then
      raise exception 'layering settings require authoritative endpoint';
    end if;
    if tg_table_name = 'broker_accounts' and tg_op = 'UPDATE'
       and public.layering_channel_configs_guard_fragment(coalesce(old.channel_trading_configs, '{}'::jsonb))
         is distinct from public.layering_channel_configs_guard_fragment(coalesce(new.channel_trading_configs, '{}'::jsonb)) then
      raise exception 'layering settings require authoritative endpoint';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists broker_accounts_prevent_client_layering_settings_bypass on public.broker_accounts;
create trigger broker_accounts_prevent_client_layering_settings_bypass
  before insert or update on public.broker_accounts
  for each row execute function public.prevent_client_layering_settings_bypass();

drop trigger if exists broker_channel_configs_prevent_client_layering_settings_bypass on public.broker_channel_trading_configs;
create trigger broker_channel_configs_prevent_client_layering_settings_bypass
  before insert or update on public.broker_channel_trading_configs
  for each row execute function public.prevent_client_layering_settings_bypass();

drop function if exists public.activate_layering_plan(text, text, jsonb);

create or replace function public.activate_layering_plan(
  p_layer_plan_id text,
  p_semantic_fingerprint text,
  p_execution_mechanism text,
  p_exclude_first_layer boolean,
  p_leg_context jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.layering_plans%rowtype;
  v_leg_count int;
  v_total_count int;
  v_mode text;
  v_schema_version int;
  v_calculator_version text;
  v_funded jsonb;
  v_lots jsonb;
  v_start_idx int;
begin
  select *
    into v_plan
    from public.layering_plans
   where layer_plan_id = p_layer_plan_id
   for update;

  if not found then
    return 'not_found';
  end if;

  if v_plan.status = 'active' then
    return 'already_active';
  end if;
  if v_plan.status = 'activating' then
    return 'already_activating';
  end if;
  if v_plan.status in ('entries_complete', 'completed', 'cancelling', 'cancellation_pending', 'cancellation_manual_review', 'cancelled', 'invalid') then
    return 'terminal_plan';
  end if;
  if v_plan.status <> 'prepared' then
    return 'activation_failed';
  end if;
  if v_plan.semantic_fingerprint <> p_semantic_fingerprint then
    return 'fingerprint_conflict';
  end if;
  if p_execution_mechanism not in ('auto', 'pending_order') then
    return 'activation_failed';
  end if;
  if p_leg_context is null or jsonb_typeof(p_leg_context) <> 'object' then
    return 'activation_failed';
  end if;

  v_schema_version := nullif(v_plan.layer_plan_metadata->>'schemaVersion', '')::int;
  v_calculator_version := nullif(trim(v_plan.layer_plan_metadata->>'calculatorVersion'), '');
  v_mode := v_plan.layer_plan_metadata->>'mode';
  if v_schema_version <> 1
     or v_calculator_version is distinct from 'layering-v1'
     or v_mode not in ('static', 'dynamic')
     or v_mode <> v_plan.mode then
    return 'activation_failed';
  end if;
  if (v_plan.layer_plan_metadata->>'planId') <> v_plan.layer_plan_id
     or (v_plan.layer_plan_metadata->>'signalId')::uuid <> v_plan.signal_id
     or (v_plan.layer_plan_metadata->>'brokerAccountId')::uuid <> v_plan.broker_account_id
     or coalesce(v_plan.layer_plan_metadata->>'basketKey', '') <> v_plan.basket_key then
    return 'activation_failed';
  end if;
  if (p_leg_context->>'signal_id')::uuid <> v_plan.signal_id
     or (p_leg_context->>'broker_account_id')::uuid <> v_plan.broker_account_id then
    return 'activation_failed';
  end if;
  if p_exclude_first_layer then
    if nullif(p_leg_context->>'first_execution_order_id', '') is null
       or nullif(p_leg_context->>'first_execution_status', '') <> 'confirmed'
       or nullif(p_leg_context->>'first_execution_fill_price', '')::numeric <= 0
       or nullif(p_leg_context->>'first_execution_filled_lot', '')::numeric <= 0
       or nullif(p_leg_context->>'first_execution_confirmed_at', '')::timestamptz is null then
      return 'activation_failed';
    end if;
  end if;

  v_funded := v_plan.layer_plan_metadata->'fundedPrices';
  v_lots := v_plan.layer_plan_metadata->'lots';
  if jsonb_typeof(v_funded) <> 'array'
     or jsonb_typeof(v_lots) <> 'array'
     or jsonb_array_length(v_funded) = 0
     or jsonb_array_length(v_funded) <> jsonb_array_length(v_lots) then
    return 'activation_failed';
  end if;
  v_start_idx := case when p_exclude_first_layer then 2 else 1 end;
  if v_start_idx > jsonb_array_length(v_funded) + 1 then
    return 'activation_failed';
  end if;

  if exists (select 1 from public.range_pending_legs where layer_plan_id = p_layer_plan_id) then
    return 'activation_failed';
  end if;

  update public.layering_plans
     set status = 'activating',
         first_execution_trade_id = nullif(p_leg_context->>'first_execution_trade_id', '')::uuid,
         first_execution_order_id = nullif(p_leg_context->>'first_execution_order_id', ''),
         first_execution_status = nullif(p_leg_context->>'first_execution_status', ''),
         first_execution_fill_price = nullif(p_leg_context->>'first_execution_fill_price', '')::numeric,
         first_execution_filled_lot = nullif(p_leg_context->>'first_execution_filled_lot', '')::numeric,
         first_execution_confirmed_at = nullif(p_leg_context->>'first_execution_confirmed_at', '')::timestamptz,
         updated_at = now(),
         activated_at = coalesce(activated_at, now())
   where layer_plan_id = p_layer_plan_id
     and status = 'prepared'
     and semantic_fingerprint = p_semantic_fingerprint;

  insert into public.range_pending_legs (
    signal_id,
    user_id,
    broker_account_id,
    metaapi_account_id,
    symbol,
    step_idx,
    is_buy,
    volume,
    anchor_price,
    trigger_price,
    stoploss,
    takeprofit,
    slippage,
    comment,
    expert_id,
    expires_at,
    status,
    ticket,
    cwe_close_price,
    layer_plan_id,
    layer_plan_metadata,
    broker_client_reference,
    broker_pending_type,
    native_submission_status,
    submission_attempt,
    submitted_at,
    confirmed_at,
    last_reconciled_at,
    broker_pending_reason,
    reconciliation_reason
  )
  select
    v_plan.signal_id,
    (p_leg_context->>'user_id')::uuid,
    v_plan.broker_account_id,
    p_leg_context->>'metaapi_account_id',
    v_plan.layer_plan_metadata->>'symbol',
    prices.ord::int,
    (v_plan.layer_plan_metadata->>'side') = 'buy',
    (v_lots->>(prices.ord - 1))::numeric,
    coalesce(
      nullif(v_plan.layer_plan_metadata->>'executableAnchorPrice', '')::numeric,
      nullif(v_plan.layer_plan_metadata->>'anchorPrice', '')::numeric,
      prices.price::numeric
    ),
    prices.price::numeric,
    nullif(p_leg_context->>'stoploss', '')::numeric,
    nullif(p_leg_context->>'takeprofit', '')::numeric,
    coalesce((p_leg_context->>'slippage')::int, 20),
    p_leg_context->>'comment',
    nullif(p_leg_context->>'expert_id', '')::int,
    nullif(p_leg_context->>'expires_at', '')::timestamptz,
    case when p_execution_mechanism = 'pending_order' then 'broker_pending' else 'pending' end,
    null,
    nullif(p_leg_context->>'cwe_close_price', '')::numeric,
    p_layer_plan_id,
    v_plan.layer_plan_metadata,
    null,
    case when p_execution_mechanism = 'pending_order' then p_leg_context->>'broker_pending_type' else null end,
    case when p_execution_mechanism = 'pending_order' then 'planned' else null end,
    0,
    null,
    null,
    null,
    null,
    null
  from jsonb_array_elements_text(v_funded) with ordinality as prices(price, ord)
  where prices.ord >= v_start_idx
    and prices.price::numeric > 0
    and (v_lots->>(prices.ord - 1))::numeric > 0;

  get diagnostics v_leg_count = row_count;
  v_total_count := jsonb_array_length(v_funded) - v_start_idx + 1;
  if v_leg_count <> greatest(v_total_count, 0) then
    raise exception 'layering plan leg materialization count mismatch';
  end if;

  update public.layering_plans
     set status = 'active',
         updated_at = now(),
         activated_at = coalesce(activated_at, now())
   where layer_plan_id = p_layer_plan_id
     and status = 'activating';

  return 'activated';
exception when unique_violation then
  return 'activation_failed';
end;
$$;

comment on function public.activate_layering_plan(text, text, text, boolean, jsonb) is
  'Worker-only CAS activation: prepared plan plus exact semantic fingerprint atomically materializes funded range_pending_legs from persisted metadata and marks the plan active.';

revoke all on function public.activate_layering_plan(text, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.activate_layering_plan(text, text, text, boolean, jsonb) to service_role;
