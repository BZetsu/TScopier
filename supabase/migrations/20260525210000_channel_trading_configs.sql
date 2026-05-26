-- Per-channel trading configuration on broker_accounts (copier_mode, manual_settings, ai_settings).

alter table public.broker_accounts
  add column if not exists channel_trading_configs jsonb not null default '{}'::jsonb;

comment on column public.broker_accounts.channel_trading_configs is
  'Map of telegram_channels.id -> { copier_mode, manual_settings, ai_settings }. Legacy broker-level columns are fallback only.';

-- Backfill: copy current broker-level settings to each linked channel.
update public.broker_accounts ba
set channel_trading_configs = sub.configs
from (
  select
    b.id,
    coalesce(
      (
        select jsonb_object_agg(
          channel_id,
          jsonb_build_object(
            'copier_mode', coalesce(b.copier_mode, 'manual'),
            'manual_settings', coalesce(b.manual_settings, '{}'::jsonb),
            'ai_settings', coalesce(b.ai_settings, '{}'::jsonb)
          )
        )
        from unnest(b.signal_channel_ids) as channel_id
      ),
      '{}'::jsonb
    ) as configs
  from public.broker_accounts b
  where b.signal_channel_ids is not null
    and cardinality(b.signal_channel_ids) > 0
) sub
where ba.id = sub.id;
