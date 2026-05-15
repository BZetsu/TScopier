/*
  # Auto-management (move SL to breakeven)

  When manual auto-management is enabled, the executor snapshots trigger
  settings onto the trades row. autoManagementMonitor polls open trades
  with auto_be_mode set and auto_be_applied_at null.
*/

alter table public.trades
  add column if not exists auto_be_mode text,
  add column if not exists auto_be_trigger_value numeric(20, 8),
  add column if not exists auto_be_tp_index integer,
  add column if not exists auto_be_type text,
  add column if not exists auto_be_offset_pips numeric(12, 4),
  add column if not exists auto_be_risk_sl numeric(20, 8),
  add column if not exists auto_be_applied_at timestamptz;

comment on column public.trades.auto_be_mode is
  'Trigger mode snapshot: pips | rr | money | tp_hit. NULL = no auto BE watch.';
comment on column public.trades.auto_be_risk_sl is
  'Initial stop loss at open for RR trigger math.';
comment on column public.trades.auto_be_applied_at is
  'When set, auto breakeven has been applied (monitor skips).';

create index if not exists trades_auto_be_open_idx
  on public.trades (broker_account_id, symbol)
  where status = 'open'
    and auto_be_mode is not null
    and auto_be_applied_at is null;
