/*
  Broker Pending mode stores live BuyLimit/SellLimit rungs as
  range_pending_legs.status = 'broker_pending'. The previous unique index only
  covered virtual statuses (pending/claimed), so two concurrent materialize
  passes could INSERT the same step twice after both OrderSends — duplicate
  limits at the same price on the chart.

  Expand the partial unique index to include broker_pending.
*/

-- Cancel older duplicate broker_pending rows (keep newest ticket per step).
with ranked as (
  select
    id,
    row_number() over (
      partition by signal_id, broker_account_id, symbol, step_idx
      order by
        case when ticket is not null and ticket <> '' then 0 else 1 end,
        created_at desc nulls last,
        id desc
    ) as rn
  from public.range_pending_legs
  where status = 'broker_pending'
)
update public.range_pending_legs r
set
  status = 'cancelled',
  error_message = coalesce(nullif(r.error_message, ''), 'duplicate_broker_pending_step_cleanup')
from ranked
where r.id = ranked.id
  and ranked.rn > 1;

drop index if exists public.range_pending_legs_active_step_unique;

create unique index if not exists range_pending_legs_active_step_unique
  on public.range_pending_legs (signal_id, broker_account_id, symbol, step_idx)
  where status in ('pending', 'claimed', 'broker_pending');

comment on index public.range_pending_legs_active_step_unique is
  'At most one active virtual (pending/claimed) or broker_pending leg per (signal, broker, symbol, step_idx).';
