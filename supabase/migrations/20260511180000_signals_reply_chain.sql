-- Reply-chain: link Telegram replies to parent signal rows for deterministic trade management.
alter table public.signals
  add column if not exists reply_to_message_id text;

create index if not exists signals_user_channel_msg_idx
  on public.signals (user_id, channel_id, telegram_message_id)
  where telegram_message_id is not null;

create index if not exists signals_parent_signal_idx
  on public.signals (parent_signal_id)
  where parent_signal_id is not null;

create index if not exists signals_reply_orphan_idx
  on public.signals (user_id, channel_id, created_at)
  where reply_to_message_id is not null and parent_signal_id is null;
