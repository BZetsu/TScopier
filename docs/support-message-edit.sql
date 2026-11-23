-- Support message editing — production migration
-- Project: sxkpcovbyaficvtkpsdo (Supabase SQL Editor -> New query -> paste -> Run)
-- Safe to run twice. Touches only public.support_messages.
-- Run BEFORE deploying the support desk build.
--
-- Plain English:
--   * edited_at          remembers that a message was corrected, and when.
--   * the UPDATE policy  only a support agent/admin may change a message, and
--                        only when sender_type = 'agent'. Customer messages,
--                        AI answers and system notices are locked. Enforced by
--                        the database, not just by the interface.
--   * the trigger        stops anyone rewriting who a message belongs to or
--                        when it was sent, and stamps edited_at on a text change.

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


-- ============================================================================
-- VERIFICATION (commented out so the file runs as one script; run these one at
-- a time afterwards — you want ONE row back from each)
-- ============================================================================

-- select column_name from information_schema.columns
--  where table_name = 'support_messages' and column_name = 'edited_at';

-- select policyname from pg_policies
--  where tablename = 'support_messages' and cmd = 'UPDATE';

-- select tgname from pg_trigger
--  where tgname = 'support_messages_guard_edit' and tgisdeleted = false;


-- ============================================================================
-- ROLLBACK (only if ever needed)
-- ============================================================================

-- drop trigger if exists support_messages_guard_edit on public.support_messages;
-- drop function if exists public.support_messages_guard_edit();
-- drop policy if exists "Support agents edit agent messages" on public.support_messages;
-- alter table public.support_messages drop column if exists edited_at;
