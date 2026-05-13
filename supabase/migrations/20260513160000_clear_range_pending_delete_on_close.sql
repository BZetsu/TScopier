/*
  Replace basket-empty cleanup: DELETE all range_pending_legs for the
  (signal_id, broker_account_id, symbol) basket when the last trade closes,
  instead of marking rows cancelled. Keeps the queue empty for that signal
  slice so nothing can re-fire or linger in any status.
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

  delete from public.range_pending_legs r
  where r.signal_id = new.signal_id
    and r.broker_account_id = new.broker_account_id
    and r.symbol = new.symbol;

  return new;
end;
$$;

comment on function public.cancel_range_pending_legs_when_basket_empty() is
  'AFTER UPDATE on trades: delete all range_pending_legs for the basket when no open/pending trade remains for the same signal, broker, and symbol.';
