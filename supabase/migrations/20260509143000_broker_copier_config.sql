-- Per-broker copier routing and AI sizing (persisted from Account & Configuration).

alter table public.broker_accounts
  add column if not exists copier_mode text not null default 'ai'
    check (copier_mode in ('ai', 'manual'));

alter table public.broker_accounts
  add column if not exists signal_channel_ids uuid[] not null default '{}';

alter table public.broker_accounts
  add column if not exists ai_settings jsonb not null default '{}'::jsonb;

comment on column public.broker_accounts.copier_mode is 'ai | manual — affects default lot sizing and future strict rules.';
comment on column public.broker_accounts.signal_channel_ids is 'telegram_channels.id values this broker copies; empty = allow all channels (legacy).';
comment on column public.broker_accounts.ai_settings is 'JSON: risk_percent_per_trade, min_lot, max_lot, reference_equity, optional fallback_lot.';
