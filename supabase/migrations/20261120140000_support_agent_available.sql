/*
  Agent availability:
  - available = false → no push notifications
  - available = false → hidden from support widget team faces
    (specific user_id lookups still return the profile for chat attribution)
*/

alter table public.support_agent_notification_prefs
  add column if not exists available boolean not null default true;

comment on column public.support_agent_notification_prefs.available is
  'When false, agent receives no pushes and is hidden from the support widget.';

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
    v_row.available := true;
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

drop function if exists public.upsert_support_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean);

create or replace function public.upsert_support_notification_prefs(
  p_available boolean default true,
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
    available,
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
    coalesce(p_available, true),
    coalesce(p_agent_request, true),
    coalesce(p_assigned_chat, true),
    coalesce(p_tickets, true),
    coalesce(p_issues, true),
    coalesce(p_suggestions, true),
    coalesce(p_feedback, true),
    now()
  )
  on conflict (user_id) do update
    set available = excluded.available,
        agent_request = excluded.agent_request,
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

revoke all on function public.upsert_support_notification_prefs(
  boolean, boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function public.upsert_support_notification_prefs(
  boolean, boolean, boolean, boolean, boolean, boolean, boolean
) to authenticated;

create or replace function public.support_public_agent_profiles(p_user_ids uuid[] default null)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    up.user_id,
    coalesce(
      nullif(trim(both from concat_ws(' ', up.first_name, up.last_name)), ''),
      nullif(trim(up.display_name), ''),
      'Support'
    ) as display_name,
    up.avatar_url
  from public.user_profiles up
  left join public.support_agent_notification_prefs prefs
    on prefs.user_id = up.user_id
  where (up.is_support_agent = true or up.is_admin = true)
    and (
      -- Specific lookups (chat attribution) always return the profile.
      (
        p_user_ids is not null
        and cardinality(p_user_ids) > 0
        and up.user_id = any (p_user_ids)
      )
      or (
        (p_user_ids is null or cardinality(p_user_ids) = 0)
        and coalesce(prefs.available, true) = true
      )
    )
  order by up.updated_at desc nulls last
  limit 24;
$$;

revoke all on function public.support_public_agent_profiles(uuid[]) from public;
grant execute on function public.support_public_agent_profiles(uuid[]) to anon, authenticated, service_role;
