/*
  Final widen for cancel_range_pending_legs_when_basket_empty:

  Previous revision matched (signal_id, symbol) on both the EXISTS guard and
  the DELETE. Broker-resolved symbols often differ between `trades.symbol` and
  `range_pending_legs.symbol` (e.g. XAUUSD vs XAUUSDm). After closing the 10
  trades whose rows use one spelling, the trigger could still see "open"
  nothing for (signal_id, other_spelling) and only delete half the ladder — or
  skip delete while orphans remained.

  Now: if there is no open/pending trade left for this **signal_id** on any
  broker or symbol, delete **every** `range_pending_legs` row for that signal.

  One Telegram signal → one `signals.id`; all copier legs for that dispatch
  share that id, so this is the correct basket boundary.
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

  if new.signal_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.trades t
    where t.signal_id = new.signal_id
      and t.status in ('open', 'pending')
  ) then
    return new;
  end if;

  delete from public.range_pending_legs r
  where r.signal_id = new.signal_id;

  return new;
end;
$$;

comment on function public.cancel_range_pending_legs_when_basket_empty() is
  'AFTER UPDATE on trades: delete all range_pending_legs for signal_id when no open/pending trade remains for that signal (any broker, any symbol).';
