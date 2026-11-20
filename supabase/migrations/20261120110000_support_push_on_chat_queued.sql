/*
  Push when a live chat moves to 'queued' (customer requested a human agent).

  Email already covers this via enqueue_support_chat_notification / support-notify.
  Mobile push only fired on user messages, tickets, flags, and feedback — so an
  escalate that inserts a system message never notified agents on device.
*/

create or replace function public.trg_support_push_on_queued()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'queued' and coalesce(old.status, '') <> 'queued' then
    perform public.invoke_support_push(jsonb_build_object(
      'event', 'chat_queued',
      'title', 'Agent requested',
      'body', left(
        coalesce(nullif(trim(new.subject), ''), 'A customer is waiting for a human agent'),
        140
      ),
      'data', jsonb_build_object(
        'type', 'chat',
        'conversationId', new.id
      )
    ));
  end if;
  return new;
exception
  when others then
    raise warning 'support push enqueue (chat_queued) failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists support_push_on_queued on public.support_conversations;
create trigger support_push_on_queued
  after update of status on public.support_conversations
  for each row execute function public.trg_support_push_on_queued();

revoke all on function public.trg_support_push_on_queued() from public, anon, authenticated;
