/*
  1. Flag current admins as support agents.
  2. Available toggle syncs user_profiles.is_support_agent.
  3. is_support_agent() checks the column only (admins who turn Available off
     lose support-desk access; is_admin stays for other admin tools).
  4. Widget / reassign lists use is_support_agent, not is_admin alone.
*/

-- Backfill: every admin is a support agent by default.
update public.user_profiles
set is_support_agent = true
where coalesce(is_admin, false) = true
  and coalesce(is_support_agent, false) = false;

-- Prefs rows for those agents (available on).
insert into public.support_agent_notification_prefs (
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
select
  up.user_id,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  now()
from public.user_profiles up
where coalesce(up.is_support_agent, false) = true
on conflict (user_id) do nothing;

-- Support desk access = is_support_agent column only.
create or replace function public.is_support_agent()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select up.is_support_agent = true
      from public.user_profiles up
      where up.user_id = auth.uid()
    ),
    false
  );
$$;

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
  -- Admins can read prefs while unavailable so they can turn Available back on.
  if not (public.is_support_agent() or public.is_admin()) then
    raise exception 'Not a support agent';
  end if;

  select * into v_row
  from public.support_agent_notification_prefs
  where user_id = auth.uid();

  if not found then
    v_row.user_id := auth.uid();
    v_row.available := public.is_support_agent();
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
  v_available boolean := coalesce(p_available, true);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Allow while unavailable if still an admin (so Available can be turned back on).
  if not (public.is_support_agent() or public.is_admin()) then
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
    v_available,
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

  -- Available off → not a support agent (portal + widget). Available on → restore.
  update public.user_profiles
  set is_support_agent = v_available
  where user_id = auth.uid();

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
  where
    (
      -- Specific lookups (chat attribution) always return the profile.
      p_user_ids is not null
      and cardinality(p_user_ids) > 0
      and up.user_id = any (p_user_ids)
    )
    or (
      (p_user_ids is null or cardinality(p_user_ids) = 0)
      and up.is_support_agent = true
      and coalesce(prefs.available, true) = true
    )
  order by up.updated_at desc nulls last
  limit 24;
$$;

revoke all on function public.support_public_agent_profiles(uuid[]) from public;
grant execute on function public.support_public_agent_profiles(uuid[]) to anon, authenticated, service_role;

-- Reassign targets must be active support agents.
create or replace function public.support_reassign_conversation(
  p_conversation_id uuid,
  p_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_assignee_name text;
  v_ok boolean;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.is_support_agent() then
    raise exception 'Support agent access required' using errcode = '42501';
  end if;
  if p_assignee_id is null then
    raise exception 'Assignee required' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.user_profiles up
    left join public.support_agent_notification_prefs prefs
      on prefs.user_id = up.user_id
    where up.user_id = p_assignee_id
      and up.is_support_agent = true
      and coalesce(prefs.available, true) = true
  ) into v_ok;

  if not v_ok then
    raise exception 'Assignee must be an available support agent' using errcode = '42501';
  end if;

  update public.support_conversations
  set status = 'active',
      assignee_id = p_assignee_id,
      updated_at = now()
  where id = p_conversation_id
    and status in ('queued', 'active');

  if not found then
    raise exception 'Conversation not available to reassign' using errcode = 'P0002';
  end if;

  v_actor_name := coalesce(public.support_agent_display_name(v_actor), 'A support agent');
  v_assignee_name := coalesce(public.support_agent_display_name(p_assignee_id), 'a support agent');

  insert into public.support_messages (conversation_id, sender_type, sender_user_id, body)
  values (
    p_conversation_id,
    'system',
    v_actor,
    v_actor_name || ' reassigned the chat to ' || v_assignee_name || '.'
  );
end;
$$;

revoke all on function public.support_reassign_conversation(uuid, uuid) from public, anon;
grant execute on function public.support_reassign_conversation(uuid, uuid) to authenticated;
