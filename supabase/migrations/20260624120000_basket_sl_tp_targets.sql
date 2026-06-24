/*
  # basket_sl_tp_targets

  Per-basket "evolving signal" — the single authoritative SL/TP intent for an
  open basket (one entry signal on one broker). Written once per instruction:
    - entry      (seed from the parsed signal)
    - adjust     (channel "Adjust/Set/Change/Make SL/TP")
    - breakeven  (channel "Move SL to breakeven")
    - auto_breakeven (settings-driven auto-BE)

  "Latest instruction wins": every write stamps updated_at = now() and overwrites
  the relevant side (SL and/or TP). resolveEffectiveBasketStops reads this FIRST
  as the authoritative source, removing the multi-path recency heuristics that
  caused breakeven/adjust to revert and TP to repaint.
*/

create table if not exists public.basket_sl_tp_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_account_id uuid not null references public.broker_accounts(id) on delete cascade,
  anchor_signal_id uuid not null references public.signals(id) on delete cascade,
  channel_id uuid,
  symbol text not null,
  stoploss numeric(20, 8),
  tp_levels numeric(20, 8)[] not null default '{}',
  source text not null default 'entry',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists basket_sl_tp_targets_basket_unique
  on public.basket_sl_tp_targets (broker_account_id, anchor_signal_id);

create index if not exists basket_sl_tp_targets_user_idx
  on public.basket_sl_tp_targets (user_id);

alter table public.basket_sl_tp_targets enable row level security;

create policy "Users can view own basket sl tp targets"
  on public.basket_sl_tp_targets for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own basket sl tp targets"
  on public.basket_sl_tp_targets for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own basket sl tp targets"
  on public.basket_sl_tp_targets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own basket sl tp targets"
  on public.basket_sl_tp_targets for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.basket_sl_tp_targets is
  'Authoritative latest SL/TP intent per open basket (broker + anchor signal). Written on entry/adjust/breakeven/auto-breakeven; read first by resolveEffectiveBasketStops.';
