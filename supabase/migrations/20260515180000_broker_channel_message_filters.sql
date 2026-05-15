/*
  Per-broker, per-channel allow/ignore rules for parsed management actions.
  Shape: { "<telegram_channel_uuid>": { "close_full": "allow"|"ignore", ... } }
*/

alter table public.broker_accounts
  add column if not exists channel_message_filters jsonb not null default '{}'::jsonb;

comment on column public.broker_accounts.channel_message_filters is
  'Map of telegram channel id -> management category -> allow|ignore. Ignored '
  'categories are not executed by the worker for signals from that channel.';
