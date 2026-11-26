-- Add Turkish to the support-chat and support-ticket locale contract.
-- Apply this migration before deploying functions that can store `tr`.

alter table public.support_conversations
  drop constraint if exists support_conversations_customer_locale_check;

alter table public.support_conversations
  add constraint support_conversations_customer_locale_check
  check (customer_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar', 'tr'));

alter table public.support_tickets
  drop constraint if exists support_tickets_customer_locale_check;

alter table public.support_tickets
  add constraint support_tickets_customer_locale_check
  check (customer_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar', 'tr'));

alter table public.support_messages
  drop constraint if exists support_messages_source_locale_check;

alter table public.support_messages
  add constraint support_messages_source_locale_check
  check (source_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar', 'tr'));

alter table public.support_ticket_messages
  drop constraint if exists support_ticket_messages_source_locale_check;

alter table public.support_ticket_messages
  add constraint support_ticket_messages_source_locale_check
  check (source_locale in ('en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja', 'ar', 'tr'));

comment on column public.support_conversations.customer_locale is
  'Support conversation language for the customer; agent replies are translated into this language. May be Turkish while the product UI remains English.';

comment on column public.support_tickets.customer_locale is
  'Support language for the requester; agent replies are translated into this language. May be Turkish while the product UI remains English.';

comment on column public.support_messages.source_locale is
  'Locale of the original body text, including Turkish support-chat messages.';

comment on column public.support_ticket_messages.source_locale is
  'Locale of the original body text, including Turkish support-ticket messages.';
