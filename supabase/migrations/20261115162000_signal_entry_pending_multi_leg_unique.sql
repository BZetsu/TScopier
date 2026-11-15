-- Allow one broker_pending row per TP leg for Single percent-split
-- (Use Signal Entry Price deferred limits). The previous unique index only
-- permitted a single active pending per (signal, broker), so TP2/TP3 inserts
-- failed and those SellLimit/BuyLimit orders were rolled back.

drop index if exists public.signal_entry_pending_orders_active_unique;

create unique index if not exists signal_entry_pending_orders_active_ticket_unique
  on public.signal_entry_pending_orders (signal_id, broker_account_id, broker_ticket)
  where status = 'broker_pending' and broker_ticket is not null;

comment on index public.signal_entry_pending_orders_active_ticket_unique is
  'At most one active broker_pending per signal+broker+ticket (supports multi-leg Single TP split).';
