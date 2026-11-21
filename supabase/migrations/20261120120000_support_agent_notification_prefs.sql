/*
  Per-agent push notification category preferences.
  Missing row = all categories enabled (same as defaults).
*/

create table if not exists public.support_agent_notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  agent_request boolean not null default true,
  assigned_chat boolean not null default true,
  tickets boolean not null default true,
  issues boolean not null default true,
  suggestions boolean not null default true,
  feedback boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.support_agent_notification_prefs is
  'Which push notification categories each support agent wants to receive.';

alter table public.support_agent_notification_prefs enable row level security;

drop policy if exists "Agents manage own notification prefs" on public.support_agent_notification_prefs;
create policy "Agents manage own notification prefs"
  on public.support_agent_notification_prefs
  for all
  to authenticated
  using (auth.uid() = user_id and public.is_support_agent())
  with check (auth.uid() = user_id and public.is_support_agent());

drop policy if exists "Service role full access notification prefs" on public.support_agent_notification_prefs;
create policy "Service role full access notification prefs"
  on public.support_agent_notification_prefs
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.get_support_notification_prefs()
returns public.support_agent_notification_prefs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.support_agent_notification_prefs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_support_agent() then
    raise exception 'Not a support agent';
  end if;

  select * into v_row
  from public.support_agent_notification_prefs
  where user_id = auth.uid();

  if not found then
    v_row.user_id := auth.uid();
    v_row.agent_request := true;
    v_row.assigned_chat := true;
    v_row.tickets := true;
    v_row.issues := true;
    v_row.suggestions := true;
    v_row.feedback := true;
    v_row.updated_at := now();
  end if;

  return v_row;
end;
$$;

revoke all on function public.get_support_notification_prefs() from public, anon;
grant execute on function public.get_support_notification_prefs() to authenticated;

create or replace function public.upsert_support_notification_prefs(
  p_agent_request boolean default true,
  p_assigned_chat boolean default true,
  p_tickets boolean default true,
  p_issues boolean default true,
  p_suggestions boolean default true,
  p_feedback boolean default true
)
returns public.support_agent_notification_prefs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.support_agent_notification_prefs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_support_agent() then
    raise exception 'Not a support agent';
  end if;

  insert into public.support_agent_notification_prefs as t (
    user_id,
    agent_request,
    assigned_chat,
    tickets,
    issues,
    suggestions,
    feedback,
    updated_at
  )
  values (
    auth.uid(),
    coalesce(p_agent_request, true),
    coalesce(p_assigned_chat, true),
    coalesce(p_tickets, true),
    coalesce(p_issues, true),
    coalesce(p_suggestions, true),
    coalesce(p_feedback, true),
    now()
  )
  on conflict (user_id) do update
    set agent_request = excluded.agent_request,
        assigned_chat = excluded.assigned_chat,
        tickets = excluded.tickets,
        issues = excluded.issues,
        suggestions = excluded.suggestions,
        feedback = excluded.feedback,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_support_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.upsert_support_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean)
  to authenticated;
