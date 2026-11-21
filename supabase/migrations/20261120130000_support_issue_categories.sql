/*
  Categorize Issues using the UniCopier support taxonomy.
  Suggestions keep issue_category NULL.
*/

alter table public.support_message_flags
  add column if not exists issue_category text;

alter table public.support_message_flags
  drop constraint if exists support_message_flags_issue_category_check;

alter table public.support_message_flags
  add constraint support_message_flags_issue_category_check
  check (
    issue_category is null
    or issue_category in (
      'trade_execution',
      'sl_tp_management',
      'telegram',
      'broker_connection',
      'backtesting',
      'settings_and_configuration',
      'subscription_and_billing',
      'customer_support',
      'account_management',
      'product_functionality'
    )
  );

create index if not exists support_message_flags_issue_category_idx
  on public.support_message_flags (kind, issue_category, status, updated_at desc)
  where kind = 'issue';

comment on column public.support_message_flags.issue_category is
  'Problem category for Issues (null for suggestions / legacy rows).';

drop function if exists public.support_mark_message_flag(uuid, text);

create or replace function public.support_mark_message_flag(
  p_message_id uuid,
  p_kind text,
  p_issue_category text default null
)
returns public.support_message_flags
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_msg public.support_messages%rowtype;
  v_convo public.support_conversations%rowtype;
  v_row public.support_message_flags;
  v_status text;
  v_category text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_support_agent() then
    raise exception 'Support agent access required' using errcode = '42501';
  end if;
  if p_kind not in ('issue', 'suggestion') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;

  v_category := nullif(trim(coalesce(p_issue_category, '')), '');
  if p_kind = 'issue' then
    if v_category is null then
      raise exception 'Issue category required' using errcode = '22023';
    end if;
    if v_category not in (
      'trade_execution',
      'sl_tp_management',
      'telegram',
      'broker_connection',
      'backtesting',
      'settings_and_configuration',
      'subscription_and_billing',
      'customer_support',
      'account_management',
      'product_functionality'
    ) then
      raise exception 'Invalid issue category' using errcode = '22023';
    end if;
  else
    v_category := null;
  end if;

  select * into v_msg from public.support_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_msg.sender_type = 'system' then
    raise exception 'Cannot flag system messages' using errcode = '22023';
  end if;

  select * into v_convo from public.support_conversations where id = v_msg.conversation_id;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  v_status := 'open';

  insert into public.support_message_flags (
    kind,
    message_id,
    conversation_id,
    marked_by_agent_id,
    customer_user_id,
    guest_name,
    guest_email,
    message_body,
    message_sender_type,
    priority,
    status,
    issue_category
  ) values (
    p_kind,
    v_msg.id,
    v_convo.id,
    v_actor,
    v_convo.user_id,
    v_convo.guest_name,
    v_convo.guest_email,
    coalesce(nullif(btrim(v_msg.body), ''), 'Shared an image'),
    v_msg.sender_type,
    'medium',
    v_status,
    v_category
  )
  on conflict (message_id, kind) do update
    set marked_by_agent_id = excluded.marked_by_agent_id,
        message_body = excluded.message_body,
        message_sender_type = excluded.message_sender_type,
        customer_user_id = excluded.customer_user_id,
        guest_name = excluded.guest_name,
        guest_email = excluded.guest_email,
        issue_category = coalesce(excluded.issue_category, public.support_message_flags.issue_category),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_mark_message_flag(uuid, text, text) from public, anon;
grant execute on function public.support_mark_message_flag(uuid, text, text) to authenticated, service_role;

drop function if exists public.support_update_message_flag(uuid, text, text);

create or replace function public.support_update_message_flag(
  p_flag_id uuid,
  p_priority text default null,
  p_status text default null,
  p_issue_category text default null
)
returns public.support_message_flags
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.support_message_flags;
  v_category text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_support_agent() then
    raise exception 'Support agent access required' using errcode = '42501';
  end if;

  select * into v_row from public.support_message_flags where id = p_flag_id;
  if not found then
    raise exception 'Flag not found' using errcode = 'P0002';
  end if;

  if p_priority is not null then
    if p_priority not in ('low', 'medium', 'high') then
      raise exception 'Invalid priority' using errcode = '22023';
    end if;
    v_row.priority := p_priority;
  end if;

  if p_status is not null then
    if v_row.kind = 'issue' and p_status not in ('open', 'closed') then
      raise exception 'Invalid status for issue' using errcode = '22023';
    end if;
    if v_row.kind = 'suggestion' and p_status not in ('open', 'implemented') then
      raise exception 'Invalid status for suggestion' using errcode = '22023';
    end if;
    v_row.status := p_status;
  end if;

  if p_issue_category is not null then
    if v_row.kind <> 'issue' then
      raise exception 'Category only applies to issues' using errcode = '22023';
    end if;
    v_category := nullif(trim(p_issue_category), '');
    if v_category is null then
      raise exception 'Issue category required' using errcode = '22023';
    end if;
    if v_category not in (
      'trade_execution',
      'sl_tp_management',
      'telegram',
      'broker_connection',
      'backtesting',
      'settings_and_configuration',
      'subscription_and_billing',
      'customer_support',
      'account_management',
      'product_functionality'
    ) then
      raise exception 'Invalid issue category' using errcode = '22023';
    end if;
    v_row.issue_category := v_category;
  end if;

  update public.support_message_flags
  set priority = v_row.priority,
      status = v_row.status,
      issue_category = v_row.issue_category,
      updated_at = now()
  where id = p_flag_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_update_message_flag(uuid, text, text, text) from public, anon;
grant execute on function public.support_update_message_flag(uuid, text, text, text)
  to authenticated, service_role;
