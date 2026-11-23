# Support message editing — database migration (copy-paste)

**What it does:** lets a support agent correct a chat message they already sent.
**Where it runs:** production Supabase project `sxkpcovbyaficvtkpsdo` → SQL Editor → New query → paste → Run.
**Run it before** the support desk build ships. It is safe to run twice (`if not exists` / `drop if exists` everywhere) and touches only `support_messages`.

---

## 1. The SQL

```sql
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
```

---

## 2. Verify it applied

Run these three in the same SQL editor — you want **one row back from each**:

```sql
-- 1. the column
select column_name from information_schema.columns
 where table_name = 'support_messages' and column_name = 'edited_at';

-- 2. the permission rule
select policyname from pg_policies
 where tablename = 'support_messages' and cmd = 'UPDATE';

-- 3. the guard trigger
select tgname from pg_trigger
 where tgname = 'support_messages_guard_edit'
   and tgisdeleted = false;
```

---

## 3. What it means in plain English

| Part | Plain English |
|---|---|
| `edited_at` column | Remembers that a message was corrected and when. |
| The UPDATE policy | Only someone who works on the support desk (agent or admin) can change a message — and only if it's a message a **human agent** sent. Customer messages, AI answers and system notices are locked. This is enforced by the database, so hiding a button in the interface isn't the only protection. |
| The trigger | Stops anyone rewriting *who* a message belongs to or *when* it was sent, and stamps `edited_at` automatically whenever the text changes. |

---

## 4. If something goes wrong

- **Desk says "Only messages sent by a support agent can be edited" on every save** — the migration has not been applied yet (or you're on the wrong project). Run section 1.
- **Reverting** (not expected to be needed):

```sql
drop trigger if exists support_messages_guard_edit on public.support_messages;
drop function if exists public.support_messages_guard_edit();
drop policy if exists "Support agents edit agent messages" on public.support_messages;
alter table public.support_messages drop column if exists edited_at;
```

---

Source file: `supabase/migrations/20261120090000_support_message_edit.sql` · Written 2026-11-21 · Feature: agent chat-message editing (Inbox only)
