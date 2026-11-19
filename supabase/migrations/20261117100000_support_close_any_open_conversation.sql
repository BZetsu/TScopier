-- Close works on every conversation that is not already closed.
--
-- The desk shows Close on conversations whose status is 'ai' (still handled by
-- the assistant). support_close_conversation only accepted 'queued', 'active'
-- and 'resolved', so those clicks failed with "Conversation not available to
-- close" — the message an agent sees when the action is refused. Nothing was
-- wrong with the agent's permissions.

create or replace function public.support_close_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.is_support_agent() then
    raise exception 'Support agent access required' using errcode = '42501';
  end if;

  update public.support_conversations
  set status = 'closed', updated_at = now()
  where id = p_conversation_id
    and status in ('ai', 'queued', 'active', 'resolved');

  if not found then
    -- Either the id does not exist, or it is already closed.
    raise exception 'Conversation not available to close' using errcode = 'P0002';
  end if;

  insert into public.support_messages (conversation_id, sender_type, sender_user_id, body)
  values (
    p_conversation_id,
    'system',
    v_actor,
    'This conversation was closed.'
  );
end;
$$;

revoke all on function public.support_close_conversation(uuid) from public, anon;
grant execute on function public.support_close_conversation(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261117100000', '20261117100000_support_close_any_open_conversation.sql', 'opencode')
on conflict (version) do nothing;
