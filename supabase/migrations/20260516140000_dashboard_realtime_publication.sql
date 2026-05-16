/*
  # Dashboard realtime — publication tables

  Enables postgres_changes on the dashboard for trades, signals,
  broker_accounts, trade_execution_logs, and telegram_channels (channels
  may already be present from 20260507000000_realtime_listener.sql).
*/

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trades'
  ) then
    execute 'alter publication supabase_realtime add table public.trades';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trade_execution_logs'
  ) then
    execute 'alter publication supabase_realtime add table public.trade_execution_logs';
  end if;
end $$;
