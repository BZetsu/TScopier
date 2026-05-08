-- MT server suggestions catalog
create table if not exists public.mt_servers (
  id uuid primary key default gen_random_uuid(),
  server_name text not null,
  server_name_normalized text generated always as (lower(btrim(server_name))) stored,
  platform text not null default 'ANY' check (platform in ('MT4', 'MT5', 'ANY')),
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (server_name_normalized)
);

alter table public.mt_servers enable row level security;

drop policy if exists "Users can read mt server suggestions" on public.mt_servers;
create policy "Users can read mt server suggestions"
  on public.mt_servers for select
  to authenticated
  using (is_active = true);

create index if not exists mt_servers_platform_idx on public.mt_servers(platform);
create index if not exists mt_servers_name_idx on public.mt_servers(server_name_normalized);

-- Seed starters (dedupe-safe via unique(server_name_normalized)).
insert into public.mt_servers (server_name, platform, source)
values
  ('OlympicMarkets-Server', 'MT5', 'manual_seed'),
  ('M4Markets-MT5', 'MT5', 'manual_seed'),
  ('VPFX-Live', 'MT5', 'manual_seed'),
  ('VPFX-Demo', 'MT5', 'manual_seed'),
  ('Eightcap-Live', 'MT5', 'manual_seed'),
  ('Eightcap-Demo', 'MT5', 'manual_seed'),
  ('HFMarketsSA-Live2', 'MT5', 'manual_seed'),
  ('HFMarketsSA-Demo2', 'MT5', 'manual_seed'),
  ('ICMarketsEU-MT5-5', 'MT5', 'manual_seed'),
  ('ExnessBV-MT5Real', 'MT5', 'manual_seed'),
  ('ExnessVG-MT5Real', 'MT5', 'manual_seed'),
  ('Deriv-Server', 'MT5', 'manual_seed'),
  ('FTMO-Server', 'MT5', 'manual_seed'),
  ('FTMO-Demo', 'MT5', 'manual_seed'),
  ('MetaQuotes-Demo', 'MT5', 'manual_seed'),
  ('FXDDTrading-MT4 Live Server', 'MT4', 'manual_seed'),
  ('FXDDTrading-MT4 Demo Server', 'MT4', 'manual_seed'),
  ('VTMarkets-Live', 'MT4', 'manual_seed'),
  ('VTMarkets-Demo', 'MT4', 'manual_seed'),
  ('LMAXGlobal-LIVE', 'MT4', 'manual_seed'),
  ('LMAXGlobal-DEMO', 'MT4', 'manual_seed'),
  ('RoboMarketsCY-ECN', 'MT4', 'manual_seed'),
  ('RoboMarketsCY-Demo', 'MT4', 'manual_seed'),
  ('Trading.com-Demo', 'MT4', 'manual_seed'),
  ('Trading.com-Real 1', 'MT4', 'manual_seed'),
  ('HFMarketsSC-Demo Server', 'MT4', 'manual_seed'),
  ('HFMarketsSC-Live Server', 'MT4', 'manual_seed')
on conflict (server_name_normalized) do nothing;

-- Auto-learn from any already connected account server values (legacy format server|login).
insert into public.mt_servers (server_name, platform, source)
select distinct
  split_part(metaapi_account_id, '|', 1) as server_name,
  case when upper(platform) in ('MT4', 'MT5') then upper(platform) else 'ANY' end as platform,
  'learned_backfill'
from public.broker_accounts
where position('|' in metaapi_account_id) > 0
  and split_part(metaapi_account_id, '|', 1) <> ''
on conflict (server_name_normalized) do nothing;

-- Helper for bulk pasting long server lists (dedupe-safe).
create or replace function public.import_mt_servers(raw_text text, target_platform text)
returns integer
language plpgsql
security definer
as $$
declare
  inserted_count integer := 0;
begin
  with rows as (
    select trim(value) as server_name
    from regexp_split_to_table(coalesce(raw_text, ''), E'\\n') as value
  ),
  cleaned as (
    select distinct server_name
    from rows
    where server_name <> ''
  ),
  ins as (
    insert into public.mt_servers (server_name, platform, source)
    select
      server_name,
      case when upper(target_platform) in ('MT4', 'MT5') then upper(target_platform) else 'ANY' end,
      'manual_bulk_import'
    from cleaned
    on conflict (server_name_normalized) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;

  return inserted_count;
end;
$$;
