/*
  When the last trade for a (signal_id, broker_account_id, symbol) basket closes,
  cancel any worker-managed virtual range legs immediately.

  Without this, `range_pending_legs` rows stay `pending` until the monitor claims
  them; only then `getStaleLegReason` runs — so price can re-cross a trigger and
  open a new position after the basket was already flat.
*/

create or replace function public.cancel_range_pending_legs_when_basket_empty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is distinct from 'closed' then
    return new;
  end if;

  if old.status = 'closed' then
    return new;
  end if;

  if new.signal_id is null or new.broker_account_id is null or new.symbol is null then
    return new;
  end if;

  if exists (
    select 1
    from public.trades t
    where t.signal_id = new.signal_id
      and t.broker_account_id = new.broker_account_id
      and t.symbol = new.symbol
      and t.status in ('open', 'pending')
  ) then
    return new;
  end if;

  update public.range_pending_legs r
  set
    status = 'cancelled',
    error_message = 'basket_empty'
  where r.signal_id = new.signal_id
    and r.broker_account_id = new.broker_account_id
    and r.symbol = new.symbol
    and r.status in ('pending', 'claimed');

  return new;
end;
$$;

comment on function public.cancel_range_pending_legs_when_basket_empty() is
  'AFTER UPDATE on trades: cancel range_pending_legs when no open/pending trade remains for the same signal, broker, and symbol.';

drop trigger if exists tr_cancel_range_pending_when_basket_empty on public.trades;

create trigger tr_cancel_range_pending_when_basket_empty
after update of status on public.trades
for each row
when (new.status = 'closed' and old.status is distinct from 'closed')
execute function public.cancel_range_pending_legs_when_basket_empty();
