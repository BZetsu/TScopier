-- Reusable per-channel trading configuration presets (manual settings + management filters).

create table if not exists public.channel_trading_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  copier_mode text not null default 'manual',
  manual_settings jsonb not null default '{}'::jsonb,
  channel_filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_trading_presets_name_len check (char_length(trim(name)) between 1 and 80),
  constraint channel_trading_presets_user_name_unique unique (user_id, name)
);

create index if not exists channel_trading_presets_user_id_idx
  on public.channel_trading_presets (user_id, updated_at desc);

comment on table public.channel_trading_presets is
  'Named trading configs a user can apply to any linked channel on a broker account.';

alter table public.channel_trading_presets enable row level security;

create policy "Users can view own trading presets"
  on public.channel_trading_presets for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own trading presets"
  on public.channel_trading_presets for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own trading presets"
  on public.channel_trading_presets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own trading presets"
  on public.channel_trading_presets for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_channel_trading_presets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists channel_trading_presets_updated_at on public.channel_trading_presets;
create trigger channel_trading_presets_updated_at
  before update on public.channel_trading_presets
  for each row
  execute function public.set_channel_trading_presets_updated_at();
