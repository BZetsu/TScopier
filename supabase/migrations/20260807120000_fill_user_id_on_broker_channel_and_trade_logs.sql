-- Fill missing user_id on insert from broker_accounts / signals so worker
-- heal/log paths cannot raise 23502 not-null violations.

create or replace function public.trg_fill_broker_channel_trading_configs_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.broker_account_id is not null then
    select ba.user_id
      into new.user_id
    from public.broker_accounts ba
    where ba.id = new.broker_account_id;
  end if;

  if new.user_id is null then
    raise exception 'broker_channel_trading_configs.user_id is required (broker_account_id=%)',
      new.broker_account_id;
  end if;

  return new;
end;
$$;

drop trigger if exists broker_channel_trading_configs_fill_user_id
  on public.broker_channel_trading_configs;
create trigger broker_channel_trading_configs_fill_user_id
  before insert or update of broker_account_id, user_id
  on public.broker_channel_trading_configs
  for each row
  execute function public.trg_fill_broker_channel_trading_configs_user_id();

create or replace function public.trg_fill_trade_execution_logs_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.broker_account_id is not null then
    select ba.user_id
      into new.user_id
    from public.broker_accounts ba
    where ba.id = new.broker_account_id;
  end if;

  if new.user_id is null and new.signal_id is not null then
    select s.user_id
      into new.user_id
    from public.signals s
    where s.id = new.signal_id;
  end if;

  if new.user_id is null then
    raise exception 'trade_execution_logs.user_id is required (signal_id=% broker_account_id=%)',
      new.signal_id, new.broker_account_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trade_execution_logs_fill_user_id
  on public.trade_execution_logs;
create trigger trade_execution_logs_fill_user_id
  before insert
  on public.trade_execution_logs
  for each row
  execute function public.trg_fill_trade_execution_logs_user_id();
