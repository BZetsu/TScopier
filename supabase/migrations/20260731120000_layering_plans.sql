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
    check (status in ('prepared', 'active', 'completed', 'cancelled', 'invalid')),
  layer_plan_metadata jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz not null,
  activated_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint layering_plans_id_safe_chk
    check (layer_plan_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint layering_plans_metadata_object_chk
    check (jsonb_typeof(layer_plan_metadata) = 'object')
);

comment on table public.layering_plans is
  'Immutable prepared Static/Dynamic range-layering plans. Phase C stores non-executable plans only; Phase D may activate/materialize funded legs.';

comment on column public.layering_plans.layer_plan_metadata is
  'Versioned LayeringPlanSnapshot JSON. Unknown versions must fail closed in worker parsing.';

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
