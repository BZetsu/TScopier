-- Quote/reply: optional pointer to the message being answered.

alter table public.support_messages
  add column if not exists reply_to_id uuid references public.support_messages(id) on delete set null;

create index if not exists support_messages_reply_to_id_idx
  on public.support_messages (reply_to_id)
  where reply_to_id is not null;

comment on column public.support_messages.reply_to_id is
  'When set, this message is a reply quoting the referenced support_messages row.';
