-- Realtime chat + ticket translation: locale stamps and per-message translation cache.

alter table public.support_conversations
  add column if not exists customer_locale text not null default 'en';

alter table public.support_tickets
  add column if not exists customer_locale text not null default 'en';

alter table public.support_messages
  add column if not exists source_locale text not null default 'en';

alter table public.support_messages
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.support_ticket_messages
  add column if not exists source_locale text not null default 'en';

alter table public.support_ticket_messages
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.support_conversations
  drop constraint if exists support_conversations_customer_locale_check;

alter table public.support_conversations
  add constraint support_conversations_customer_locale_check
  check (customer_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar'));

alter table public.support_tickets
  drop constraint if exists support_tickets_customer_locale_check;

alter table public.support_tickets
  add constraint support_tickets_customer_locale_check
  check (customer_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar'));

alter table public.support_messages
  drop constraint if exists support_messages_source_locale_check;

alter table public.support_messages
  add constraint support_messages_source_locale_check
  check (source_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar'));

alter table public.support_ticket_messages
  drop constraint if exists support_ticket_messages_source_locale_check;

alter table public.support_ticket_messages
  add constraint support_ticket_messages_source_locale_check
  check (source_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar'));

comment on column public.support_conversations.customer_locale is
  'UniCopier UI locale for the customer; agent replies are translated into this language.';

comment on column public.support_tickets.customer_locale is
  'UniCopier UI locale for the requester; agent replies are translated into this language.';

comment on column public.support_messages.source_locale is
  'Locale of the original body text.';

comment on column public.support_messages.translations is
  'Cached translations keyed by locale code, e.g. {"es":"..."}. body stays the immutable original.';

comment on column public.support_ticket_messages.source_locale is
  'Locale of the original body text.';

comment on column public.support_ticket_messages.translations is
  'Cached translations keyed by locale code, e.g. {"es":"..."}. body stays the immutable original.';
