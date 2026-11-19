# Support notifications

Email alerts for the support desk: a new ticket, a reopened ticket, and a customer
waiting for a human in live chat. This document covers the Unicopier side (database and
edge function). The desk app itself lives in the separate `tartarixinc/support-admin`
repository.

## The problem it solves

The support desk rings a chime inside the browser for these events, but only while an
agent has the app open. Nothing happens when the tab is closed, which is how ticket #2
("Trades not executed", 2026-11-16 08:59) waited with nobody notified.

## How it works

```
ticket insert / customer reply / chat queued
   -> database trigger writes one row to support_notification_outbox
   -> pg_cron 'support-notify' every minute (only when a row is waiting)
   -> edge function support-notify claims the row, emails every enabled recipient
   -> marks the row sent, or schedules a retry with backoff
```

- Triggers never call the network, so a notification problem cannot break ticket
  creation. Each trigger body catches its own errors and logs a warning.
- `event_key` is unique per event, so a repeated trigger cannot send a duplicate.
- Delays are retried 1, 2, 4, 8, 16 and then 30 minutes. After eight attempts the row is
  flagged `failed_at` and keeps retrying every six hours for as long as it takes. A row is
  only marked sent after at least one recipient actually received it, so a long Resend or
  DNS outage cannot swallow an alert.
- Sent rows are deleted after 30 days.

## Events

| Kind | Raised when | Trigger |
|---|---|---|
| `ticket_created` | any new ticket: signed-in user, guest in the widget, or inbound email | `after insert on support_tickets` |
| `ticket_reopened` | a customer replied on a resolved or closed ticket | `after insert on support_ticket_messages` when the ticket was resolved/closed at that moment |
| `chat_queued` | a live chat moved to `queued` (customer asked for a human) | `after update of status on support_conversations` |

The inbound handler inserts the customer message before it reopens the ticket, so the
reply trigger still sees the previous `resolved`/`closed` status. That ordering is what
makes `ticket_reopened` work.

A first message on a brand new ticket does not raise `ticket_reopened`, because the ticket
is already `open` at that point.

## Recipients

`public.support_notification_recipients` — one row per address, `enabled` to pause someone
without deleting them. Add a person with:

```sql
insert into public.support_notification_recipients (email) values ('name@example.com');
```

These are deliberately separate from `alert_recipients`. System alerts are filtered by
severity and every current recipient is set to critical only; support notifications are
not filtered, because a new ticket always matters to the people answering tickets.

If nobody is configured, the notifier **defers** each event for 30 minutes and returns an
error, so the misconfiguration is visible. The events are kept: the first address added
receives everything that arrived in the meantime, up to 25 per minute. (An earlier version
discarded them, the same silent failure that `alert_recipients` had in October.) Ticket
volume is around two per month, so releasing the backlog is a few emails, not a flood.

## Email

Built in `supabase/functions/_shared/supportAlertEmail.ts`. Sent from
`UniCopier Alerts <alerts@unicopier.com>` (override with `SUPPORT_ALERT_FROM`) and
deliberately **not** from `support@`, because `support@` is the inbound ticket address:
a staff auto-reply answering an alert from that address would create a new ticket, which
would send another alert. There is no reply-to for the same reason.

Each email carries the ticket number, status, customer name and email, whether it came
from the app or email, the customer's language, the customer's message (trimmed to 1200
characters) and a link to the desk (`https://unicopier.support` by default; override with
`SUPPORT_DESK_URL`). Only `https://` links are ever rendered.

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Supabase edge secrets | required to send |
| `SUPPORT_DESK_URL` | optional | base address of the desk app, default `https://unicopier.support` |
| `SUPPORT_ALERT_FROM` | optional | overrides the sender address |
| `SUPPORT_NOTIFY_SERVICE_KEY` | optional | an extra token the function also accepts as a bearer, so a separate scheduler can call it without holding the project service key. It never replaces the key used for database access. |

The cron job reuses the same credential lookup as `alert-evaluator`
(`app.settings`, then `public.app_secrets`, then Supabase Vault).

## Deployment order

1. Apply `20261116150000_support_notifications.sql` (it adds `support_tickets.source`).
2. Deploy the `support-notify` function.
3. Redeploy `support-ticket-inbound`.
4. Add the recipient addresses to `support_notification_recipients`.

Steps 2 and 3 depend on step 1: the sender reads `support_tickets.source`, and the
inbound function now writes it. Deploying either before the column exists makes inbound
email fail with a 500 and the notifier retry a read error.

## When notifications themselves stop working

`support-notify` cannot report its own failure: a wrong key, a rejected sender or a stopped
job just leaves rows in the outbox. The existing alert system covers that:

- Rule `support_notify_backlog` (seed: `20261116160000_support_notify_backlog_rule.sql`,
  logic in `supabase/functions/alert-evaluator/index.ts` → `evalSupportNotifyBacklog`).
- It fires when an unsent row has waited more than `max_wait_minutes` (30), starting at
  `warning` and escalating to `critical` after another 30 minutes, because the current
  `alert_recipients` are set to critical-only.
- It resolves by itself when the queue drains, so the recovery email means "notifications
  are flowing again".
- It appears on the Alerts page in `panel.tscopier.cloud` like every other rule, and is
  sent through the evaluator's own sender, which is independent of `support-notify`.

A healthy queue, including one deliberately deferred because no recipient is configured,
never fires: the rule only looks at rows older than the threshold.

## Checking it

```sql
-- Anything still waiting, with the reason it has not gone out
select kind, ticket_id, conversation_id, attempts, failed_at, next_attempt_at, last_error
from support_notification_outbox
where sent_at is null
order by created_at;

-- Recent history
select kind, sent_at, last_error from support_notification_outbox
order by created_at desc limit 20;
```

`last_error` values to recognise:

- `deferred: no recipients configured` — nobody is on the list yet; the event is kept
- `skipped: target row no longer exists` — the ticket was deleted before the email went
- `resend failed for <email>: <reason>` — Resend rejected the address or the API call

A row with `failed_at` set has used up its normal retries and is now retried every six
hours. It still counts as unsent.

## Limits worth knowing

- One email per event, not a digest. Ticket volume is around two per month, so this is
  right for now; revisit above roughly ten a day.
- The desk app's own chime and badge counts are separate and unchanged.
- There is no email on a customer reply to a ticket that is still open or pending. The
  desk chime covers that, and the planned watchdog rule ("ticket waiting too long") would
  cover the off-desk case.
- This does not appear on the Alerts page in `panel.tscopier.cloud`; it is a separate
  outbox with its own tables.

## Files

- `supabase/migrations/20261116150000_support_notifications.sql` — tables, triggers, cron,
  retention, admin read policies, `support_tickets.source`
- `supabase/functions/support-notify/index.ts` — the sender
- `supabase/functions/_shared/supportAlertEmail.ts` — subject and body for the three events
- `supabase/functions/support-ticket-inbound/index.ts` — records `source = 'email'` on
  email-created tickets
