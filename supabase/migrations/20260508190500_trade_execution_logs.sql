create table if not exists public.trade_execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  broker_account_id uuid references public.broker_accounts(id) on delete set null,
  action text not null,
  status text not null check (status in ('attempt', 'success', 'failed')),
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.trade_execution_logs enable row level security;

drop policy if exists "Users can view own trade execution logs" on public.trade_execution_logs;
create policy "Users can view own trade execution logs"
  on public.trade_execution_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists trade_execution_logs_user_idx on public.trade_execution_logs(user_id, created_at desc);
create index if not exists trade_execution_logs_signal_idx on public.trade_execution_logs(signal_id, created_at desc);
