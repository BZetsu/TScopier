-- Let support agents correct a chat message that has already been sent.
--
-- The Inbox gets an Edit control, but the rules live here, not in the UI:
-- only a support agent (or admin) may update, and only a row with
-- sender_type = 'agent'. A customer message, an AI answer and a system
-- notice can never be rewritten.

alter table public.support_messages
  add column if not exists edited_at timestamptz;

comment on column public.support_messages.edited_at is
  'Set when a support agent corrects an already-sent chat message; null when the message has never been edited.';

drop policy if exists "Support agents edit agent messages" on public.support_messages;
create policy "Support agents edit agent messages"
  on public.support_messages for update to authenticated
  using (public.is_support_agent() and sender_type = 'agent')
  with check (public.is_support_agent() and sender_type = 'agent');

-- An update must not rewrite who a message belongs to or when it was sent,
-- and a body/image change stamps edited_at so every reader agrees the
-- message was corrected. Translations are cleared by the caller: a stored
-- translation of the old wording would otherwise keep showing it.
create or replace function public.support_messages_guard_edit()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_type is distinct from old.sender_type
     or new.sender_user_id is distinct from old.sender_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'support_messages identity fields are immutable';
  end if;

  if new.body is distinct from old.body or new.images is distinct from old.images then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

drop trigger if exists support_messages_guard_edit on public.support_messages;
create trigger support_messages_guard_edit
  before update on public.support_messages
  for each row execute function public.support_messages_guard_edit();
