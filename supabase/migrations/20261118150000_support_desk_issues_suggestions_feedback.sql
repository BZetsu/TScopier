-- Support desk: message flags (issues/suggestions), conversation CSAT feedback, agent comments.

-- 1. Message flags (Issues + Suggestions) ------------------------------------------------
create table if not exists public.support_message_flags (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('issue', 'suggestion')),
  message_id uuid not null references public.support_messages(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  marked_by_agent_id uuid not null references auth.users(id) on delete restrict,
  customer_user_id uuid references auth.users(id) on delete set null,
  guest_name text,
  guest_email text,
  message_body text not null default '',
  message_sender_type text not null default 'user'
    check (message_sender_type in ('user', 'ai', 'agent', 'system')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  -- Issues: open | closed. Suggestions: open | implemented.
  status text not null default 'open'
    check (
      (kind = 'issue' and status in ('open', 'closed'))
      or (kind = 'suggestion' and status in ('open', 'implemented'))
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, kind)
);

create index if not exists support_message_flags_kind_status_idx
  on public.support_message_flags (kind, status, updated_at desc);

create index if not exists support_message_flags_conversation_id_idx
  on public.support_message_flags (conversation_id);

create index if not exists support_message_flags_marked_by_idx
  on public.support_message_flags (marked_by_agent_id, updated_at desc);

comment on table public.support_message_flags is
  'Agent-flagged chat messages as Issues or Suggestions for the support desk.';

create or replace function public.touch_support_message_flags_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists support_message_flags_touch_updated_at on public.support_message_flags;
create trigger support_message_flags_touch_updated_at
  before update on public.support_message_flags
  for each row execute function public.touch_support_message_flags_updated_at();

alter table public.support_message_flags enable row level security;

drop policy if exists "Support agents manage message flags" on public.support_message_flags;
create policy "Support agents manage message flags"
  on public.support_message_flags for all to authenticated
  using (public.is_support_agent())
  with check (public.is_support_agent());

-- 2. Conversation feedback (CSAT) --------------------------------------------------------
create table if not exists public.support_conversation_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  rating integer check (rating is null or (rating >= 1 and rating <= 5)),
  comment text check (comment is null or char_length(comment) <= 4000),
  skipped boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  guest_email text,
  guest_name text,
  created_at timestamptz not null default now(),
  constraint support_conversation_feedback_response_check check (
    skipped = true or rating is not null
  ),
  unique (conversation_id)
);

create index if not exists support_conversation_feedback_created_at_idx
  on public.support_conversation_feedback (created_at desc);

comment on table public.support_conversation_feedback is
  'Post-chat CSAT (1–5) or skip from the customer SupportWidget.';

alter table public.support_conversation_feedback enable row level security;

drop policy if exists "Support agents select conversation feedback" on public.support_conversation_feedback;
create policy "Support agents select conversation feedback"
  on public.support_conversation_feedback for select to authenticated
  using (public.is_support_agent());

drop policy if exists "Users select own conversation feedback" on public.support_conversation_feedback;
create policy "Users select own conversation feedback"
  on public.support_conversation_feedback for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- Inserts go through security definer RPCs (auth user or guest_token).

-- 3. Desk comments (issues, suggestions, feedback) ---------------------------------------
create table if not exists public.support_desk_comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('issue', 'suggestion', 'feedback')),
  target_id uuid not null,
  author_agent_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 8000),
  created_at timestamptz not null default now()
);

create index if not exists support_desk_comments_target_idx
  on public.support_desk_comments (target_type, target_id, created_at);

comment on table public.support_desk_comments is
  'Internal agent comments on Issues, Suggestions, and Feedback items.';

alter table public.support_desk_comments enable row level security;

drop policy if exists "Support agents manage desk comments" on public.support_desk_comments;
create policy "Support agents manage desk comments"
  on public.support_desk_comments for all to authenticated
  using (public.is_support_agent())
  with check (public.is_support_agent());

-- 4. RPCs --------------------------------------------------------------------------------

create or replace function public.support_mark_message_flag(
  p_message_id uuid,
  p_kind text
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
    status
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
    v_status
  )
  on conflict (message_id, kind) do update
    set marked_by_agent_id = excluded.marked_by_agent_id,
        message_body = excluded.message_body,
        message_sender_type = excluded.message_sender_type,
        customer_user_id = excluded.customer_user_id,
        guest_name = excluded.guest_name,
        guest_email = excluded.guest_email,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_mark_message_flag(uuid, text) from public, anon;
grant execute on function public.support_mark_message_flag(uuid, text) to authenticated, service_role;

create or replace function public.support_update_message_flag(
  p_flag_id uuid,
  p_priority text default null,
  p_status text default null
)
returns public.support_message_flags
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.support_message_flags;
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
      raise exception 'Invalid issue status' using errcode = '22023';
    end if;
    if v_row.kind = 'suggestion' and p_status not in ('open', 'implemented') then
      raise exception 'Invalid suggestion status' using errcode = '22023';
    end if;
    v_row.status := p_status;
  end if;

  update public.support_message_flags
  set priority = v_row.priority,
      status = v_row.status,
      updated_at = now()
  where id = p_flag_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_update_message_flag(uuid, text, text) from public, anon;
grant execute on function public.support_update_message_flag(uuid, text, text) to authenticated, service_role;

create or replace function public.support_add_desk_comment(
  p_target_type text,
  p_target_id uuid,
  p_body text
)
returns public.support_desk_comments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.support_desk_comments;
  v_ok boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_support_agent() then
    raise exception 'Support agent access required' using errcode = '42501';
  end if;
  if p_target_type not in ('issue', 'suggestion', 'feedback') then
    raise exception 'Invalid target type' using errcode = '22023';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 8000 then
    raise exception 'Comment required (≤ 8000 chars)' using errcode = '22023';
  end if;

  if p_target_type in ('issue', 'suggestion') then
    select exists (
      select 1 from public.support_message_flags f
      where f.id = p_target_id
        and f.kind = p_target_type
    ) into v_ok;
  else
    select exists (
      select 1 from public.support_conversation_feedback f
      where f.id = p_target_id
    ) into v_ok;
  end if;

  if not v_ok then
    raise exception 'Target not found' using errcode = 'P0002';
  end if;

  insert into public.support_desk_comments (target_type, target_id, author_agent_id, body)
  values (p_target_type, p_target_id, v_actor, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_add_desk_comment(text, uuid, text) from public, anon;
grant execute on function public.support_add_desk_comment(text, uuid, text) to authenticated, service_role;

create or replace function public.support_submit_conversation_feedback(
  p_conversation_id uuid,
  p_rating integer default null,
  p_comment text default null,
  p_skipped boolean default false,
  p_guest_token text default null
)
returns public.support_conversation_feedback
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_convo public.support_conversations%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_row public.support_conversation_feedback;
  v_guest uuid;
begin
  select * into v_convo from public.support_conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  if v_convo.status not in ('resolved', 'closed') then
    raise exception 'Feedback only after resolve/close' using errcode = '22023';
  end if;

  if v_actor is not null then
    if v_convo.user_id is distinct from v_actor and not public.is_support_agent() then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  else
    begin
      v_guest := nullif(btrim(coalesce(p_guest_token, '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid guest token' using errcode = '22023';
    end;
    if v_guest is null or v_convo.guest_token is distinct from v_guest then
      raise exception 'Guest auth required' using errcode = '42501';
    end if;
  end if;

  if p_skipped is true then
    insert into public.support_conversation_feedback (
      conversation_id, rating, comment, skipped, user_id, guest_email, guest_name
    ) values (
      v_convo.id, null, null, true, v_convo.user_id, v_convo.guest_email, v_convo.guest_name
    )
    on conflict (conversation_id) do update
      set skipped = true,
          rating = null,
          comment = null
    returning * into v_row;
    return v_row;
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1–5' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 4000 then
    raise exception 'Comment too long' using errcode = '22023';
  end if;

  insert into public.support_conversation_feedback (
    conversation_id, rating, comment, skipped, user_id, guest_email, guest_name
  ) values (
    v_convo.id, p_rating, v_comment, false, v_convo.user_id, v_convo.guest_email, v_convo.guest_name
  )
  on conflict (conversation_id) do update
    set rating = excluded.rating,
        comment = excluded.comment,
        skipped = false
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.support_submit_conversation_feedback(uuid, integer, text, boolean, text)
  from public;
grant execute on function public.support_submit_conversation_feedback(uuid, integer, text, boolean, text)
  to anon, authenticated, service_role;

create or replace function public.support_conversation_feedback_status(
  p_conversation_id uuid,
  p_guest_token text default null
)
returns table (has_response boolean, skipped boolean, rating integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_convo public.support_conversations%rowtype;
  v_guest uuid;
begin
  select * into v_convo from public.support_conversations where id = p_conversation_id;
  if not found then
    return;
  end if;

  if v_actor is not null then
    if v_convo.user_id is distinct from v_actor and not public.is_support_agent() then
      return;
    end if;
  else
    begin
      v_guest := nullif(btrim(coalesce(p_guest_token, '')), '')::uuid;
    exception when invalid_text_representation then
      return;
    end;
    if v_guest is null or v_convo.guest_token is distinct from v_guest then
      return;
    end if;
  end if;

  return query
  select true, f.skipped, f.rating
  from public.support_conversation_feedback f
  where f.conversation_id = p_conversation_id;
end;
$$;

revoke all on function public.support_conversation_feedback_status(uuid, text) from public;
grant execute on function public.support_conversation_feedback_status(uuid, text)
  to anon, authenticated, service_role;
