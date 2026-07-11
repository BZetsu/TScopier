/*
  When a signal basket goes flat, do not hard-DELETE broker_pending range legs —
  mark them cancelled so the worker can OrderClose at the broker first.
  Virtual pending rows (pending/claimed) are still deleted immediately.
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

  update public.range_pending_legs r
  set
    status = 'cancelled',
    error_message = 'basket_empty'
  where r.signal_id = new.signal_id
    and r.status = 'broker_pending';

  delete from public.range_pending_legs r
  where r.signal_id = new.signal_id
    and r.status in ('pending', 'claimed');

  update public.signal_entry_pending_orders s
  set
    cancel_requested_at = coalesce(s.cancel_requested_at, now()),
    cancel_reason = coalesce(s.cancel_reason, 'basket_empty'),
    updated_at = now()
  where s.signal_id = new.signal_id
    and s.status = 'broker_pending'
    and s.cancel_requested_at is null;

  update public.signal_range_entry_waits w
  set status = 'cancelled', updated_at = now()
  where w.signal_id = new.signal_id
    and w.status = 'waiting';

  return new;
end;
$$;

comment on function public.cancel_range_pending_legs_when_basket_empty() is
  'AFTER UPDATE on trades: cancel broker_pending range legs (worker closes at broker); delete virtual pending/claimed rows when signal basket is flat.';
