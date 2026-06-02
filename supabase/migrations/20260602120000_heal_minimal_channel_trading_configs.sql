-- Replace migration/connect "seed" per-channel rows (fixed_lot + trade_style only)
-- with broker-level manual_settings when the broker has a full configuration.

update public.broker_accounts ba
set channel_trading_configs = sub.configs
from (
  select
    b.id,
    (
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from (
        select
          kv.key,
          case
            when kv.value -> 'manual_settings' is null then kv.value
            when (kv.value -> 'manual_settings') ? 'schema_version' then kv.value
            when jsonb_typeof(kv.value -> 'manual_settings') <> 'object' then kv.value
            when (
              select count(*)
              from jsonb_object_keys(kv.value -> 'manual_settings') AS k(key)
            ) > 4 then kv.value
            when coalesce(b.manual_settings, '{}'::jsonb) = '{}'::jsonb then kv.value
            when not (
              (b.manual_settings ->> 'fixed_lot') is not null
              and (b.manual_settings ->> 'trade_style') in ('single', 'multi')
            ) then kv.value
            else jsonb_set(
              kv.value,
              '{manual_settings}',
              b.manual_settings,
              true
            )
          end as value
        from jsonb_each(coalesce(b.channel_trading_configs, '{}'::jsonb)) AS kv(key, value)
      ) e
    ) as configs
  from public.broker_accounts b
  where b.signal_channel_ids is not null
    and cardinality(b.signal_channel_ids) > 0
) sub
where ba.id = sub.id
  and ba.channel_trading_configs is distinct from sub.configs;
