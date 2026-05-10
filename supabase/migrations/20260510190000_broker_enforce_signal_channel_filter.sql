-- Whitelist (signal_channel_ids) was applied whenever the array was non-empty, which
-- blocked copying from newer Telegram channels after a mistaken or stale save.
-- By default, brokers now copy all connected Telegram channels; users opt into a
-- strict subset via Account configuration (enforce_signal_channel_filter = true).

alter table public.broker_accounts
  add column if not exists enforce_signal_channel_filter boolean not null default false;

comment on column public.broker_accounts.enforce_signal_channel_filter is
  'When false (default), copy signals from all connected Telegram channels; signal_channel_ids is ignored. When true, only listed telegram channel UUIDs are copied.';

-- One-time heal: open the default (copy all) for existing accounts.
update public.broker_accounts
set enforce_signal_channel_filter = false,
    signal_channel_ids = '{}';
