/**
 * support-notify — emails the support team about tickets and chats that need a reply.
 *
 * Trigger: pg_cron job 'support-notify' every minute
 * (migration 20261116150000_support_notifications.sql). Not called by the app.
 *
 * Why an outbox
 *   Database triggers only write a row into support_notification_outbox; they
 *   never call the network, so a notification failure can never break ticket
 *   creation. This function drains the outbox: it claims a row, sends one email
 *   to every enabled recipient, and marks the row sent or schedules a retry.
 *
 * Events handled (support_notification_outbox.kind):
 *   ticket_created  — any new ticket, from the widget (signed-in or guest) or
 *                     from an inbound email to support@.
 *   ticket_reopened — a customer replied on a resolved or closed ticket.
 *   chat_queued     — a live chat moved to 'queued' (customer asked for a human).
 *
 * Retry policy
 *   Attempts 1-6 back off 1, 2, 4, 8, 16, 30 minutes. After that the row is
 *   flagged failed_at and keeps retrying every 6 hours indefinitely, so a long
 *   Resend or DNS outage can never swallow a support alert. A row is only ever
 *   marked sent after at least one recipient actually received it.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, and the
 * optional SUPPORT_NOTIFY_SERVICE_KEY (an extra accepted caller token),
 * SUPPORT_DESK_URL, SUPPORT_ALERT_FROM. The cron's Vault key is also accepted
 * as a caller token (see CRON_KEY below).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildSupportAlertEmail,
  supportAlertFrom,
  type SupportAlertKind,
} from "../_shared/supportAlertEmail.ts";
import { sendResendEmail } from "../_shared/resendSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Database access uses the platform service key, falling back to the key the
// cron actually sends (see below) if the platform value is ever absent.
const PLATFORM_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
/**
 * The pg_cron job authenticates with the service key stored in Vault. In this
 * project that value is the same one alert-evaluator uses, and it is the only
 * token the cron can produce, so it must be accepted explicitly — otherwise
 * every tick gets a 401 (observed on the first deploy).
 */
const CRON_KEY = Deno.env.get("ALERT_EVALUATOR_SERVICE_KEY") || "";
const ALT_AUTH_TOKEN = Deno.env.get("SUPPORT_NOTIFY_SERVICE_KEY")?.trim() || "";
const DB_KEY = PLATFORM_KEY || CRON_KEY;
const DESK_URL = (Deno.env.get("SUPPORT_DESK_URL") ?? "https://unicopier.support")
  .trim()
  .replace(/\/$/, "");

const BATCH_LIMIT = 25;
/** Normal retry budget before the row is flagged failed_at and slowed down. */
const MAX_ATTEMPTS = 8;
/** Must stay comfortably above the Resend request timeout (15s) times the batch. */
const CLAIM_MINUTES = 6;
const DEFER_MINUTES = 30;
const MESSAGE_MAX = 1200;

interface OutboxRow {
  id: string;
  kind: SupportAlertKind;
  ticket_id: string | null;
  conversation_id: string | null;
  attempts: number;
}

interface Email {
  subject: string;
  html: string;
  text: string;
}

function backoffMinutes(attempts: number): number {
  const steps = [1, 2, 4, 8, 16, 30];
  return steps[Math.min(Math.max(attempts, 1) - 1, steps.length - 1)];
}

function authorized(req: Request): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  for (const accepted of [PLATFORM_KEY, CRON_KEY, ALT_AUTH_TOKEN]) {
    if (accepted && token === accepted) return true;
  }
  return false;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function trimMessage(body: string | null | undefined): string | null {
  const text = String(body ?? "").trim();
  if (!text) return null;
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;
}

function sourceLabel(source: string | null | undefined, signedIn: boolean): string {
  if (source === "email") return "Inbound email";
  return signedIn ? "Signed-in user" : "Guest (support widget)";
}

async function resolveCustomer(
  admin: SupabaseClient,
  args: {
    userId: string | null;
    guestEmail: string | null;
    guestName: string | null;
  },
): Promise<{ label: string | null; email: string | null }> {
  if (args.guestEmail) {
    return { label: args.guestName?.trim() || null, email: args.guestEmail };
  }
  if (!args.userId) return { label: args.guestName?.trim() || null, email: null };

  let email: string | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(args.userId);
    email = data.user?.email?.trim().toLowerCase() ?? null;
  } catch {
    email = null;
  }

  let label: string | null = null;
  try {
    const { data } = await admin
      .from("user_profiles")
      .select("display_name, first_name, last_name")
      .eq("user_id", args.userId)
      .maybeSingle();
    const full = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
    label = String(data?.display_name ?? "").trim() || full || null;
  } catch {
    label = null;
  }

  if (!label && email) label = email.split("@")[0] ?? null;
  return { label, email };
}

async function buildTicketEmail(
  admin: SupabaseClient,
  row: OutboxRow,
): Promise<Email | null> {
  if (!row.ticket_id) return null;

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select(
      "id, number, subject, status, source, user_id, guest_name, guest_email, customer_locale, created_at",
    )
    .eq("id", row.ticket_id)
    .maybeSingle();
  // A read error is a fault to retry; a missing row means the ticket was deleted.
  if (ticketError) throw new Error(`ticket read: ${ticketError.message}`);
  if (!ticket) return null;

  const wantsFirstMessage = row.kind === "ticket_created";
  const { data: message, error: messageError } = await admin
    .from("support_ticket_messages")
    .select("body, created_at")
    .eq("ticket_id", row.ticket_id)
    .in("sender_type", ["user", "email_inbound"])
    .order("created_at", { ascending: wantsFirstMessage })
    .limit(1)
    .maybeSingle();
  if (messageError) throw new Error(`ticket message read: ${messageError.message}`);

  const customer = await resolveCustomer(admin, {
    userId: (ticket.user_id as string | null) ?? null,
    guestEmail: (ticket.guest_email as string | null) ?? null,
    guestName: (ticket.guest_name as string | null) ?? null,
  });

  return buildSupportAlertEmail({
    kind: row.kind,
    reference: `#${ticket.number}`,
    subject: String(ticket.subject ?? ""),
    sourceLabel: sourceLabel(
      (ticket.source as string | null) ?? null,
      Boolean(ticket.user_id),
    ),
    customerLabel: customer.label,
    customerEmail: customer.email,
    locale: (ticket.customer_locale as string | null) ?? null,
    status: (ticket.status as string | null) ?? null,
    message: trimMessage((message?.body as string | null) ?? null),
    createdAt: String(ticket.created_at ?? ""),
    // Links straight to this ticket; the desk selects it from the query string.
    deskUrl: `${DESK_URL}/tickets?ticket=${ticket.id}`,
  });
}

async function buildChatEmail(
  admin: SupabaseClient,
  row: OutboxRow,
): Promise<Email | null> {
  if (!row.conversation_id) return null;

  const { data: convo, error: convoError } = await admin
    .from("support_conversations")
    .select(
      "id, status, subject, user_id, guest_name, guest_email, customer_locale, created_at",
    )
    .eq("id", row.conversation_id)
    .maybeSingle();
  if (convoError) throw new Error(`conversation read: ${convoError.message}`);
  if (!convo) return null;

  const { data: message, error: messageError } = await admin
    .from("support_messages")
    .select("body")
    .eq("conversation_id", row.conversation_id)
    .eq("sender_type", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (messageError) throw new Error(`chat message read: ${messageError.message}`);

  const customer = await resolveCustomer(admin, {
    userId: (convo.user_id as string | null) ?? null,
    guestEmail: (convo.guest_email as string | null) ?? null,
    guestName: (convo.guest_name as string | null) ?? null,
  });

  return buildSupportAlertEmail({
    kind: "chat_queued",
    reference: `#${shortId(String(convo.id))}`,
    subject: String(convo.subject ?? "").trim() || "Live chat",
    sourceLabel: "Live chat",
    customerLabel: customer.label,
    customerEmail: customer.email,
    locale: (convo.customer_locale as string | null) ?? null,
    status: (convo.status as string | null) ?? null,
    message: trimMessage((message?.body as string | null) ?? null),
    createdAt: String(convo.created_at ?? ""),
    // Links straight to this conversation.
    deskUrl: `${DESK_URL}/?chat=${convo.id}`,
  });
}

// Every mark returns the database error instead of swallowing it: a lost mark
// re-sends the same email on the next tick, so it must be visible.

async function markSkipped(admin: SupabaseClient, id: string, reason: string): Promise<string | null> {
  const { error } = await admin
    .from("support_notification_outbox")
    .update({ sent_at: new Date().toISOString(), last_error: `skipped: ${reason}` })
    .eq("id", id)
    .is("sent_at", null);
  return error ? error.message : null;
}

async function markSent(admin: SupabaseClient, id: string, note: string | null): Promise<string | null> {
  const { error } = await admin
    .from("support_notification_outbox")
    .update({ sent_at: new Date().toISOString(), last_error: note })
    .eq("id", id)
    .is("sent_at", null);
  return error ? error.message : null;
}

async function markRetry(
  admin: SupabaseClient,
  row: OutboxRow,
  error: string,
): Promise<string | null> {
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const delayMs = exhausted ? 6 * 60 * 60_000 : backoffMinutes(attempts) * 60_000;
  const { error: updateError } = await admin
    .from("support_notification_outbox")
    .update({
      attempts,
      last_error: error.slice(0, 500),
      next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
      // Never mark a row sent that no recipient received. Give-ups are slowed
      // down and flagged instead, so a long outage cannot lose the alert.
      sent_at: null,
      failed_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("id", row.id)
    // Never revive a row another writer already closed.
    .is("sent_at", null);
  return updateError ? updateError.message : null;
}

/** Only when nobody is configured: hold the rows instead of discarding them. */
async function deferBatch(
  admin: SupabaseClient,
  rows: OutboxRow[],
): Promise<string[]> {
  const errors: string[] = [];
  const nextAttempt = new Date(Date.now() + DEFER_MINUTES * 60_000).toISOString();
  for (const row of rows) {
    const { error } = await admin
      .from("support_notification_outbox")
      .update({ last_error: "deferred: no recipients configured", next_attempt_at: nextAttempt })
      .eq("id", row.id)
      .is("sent_at", null);
    if (error) {
      console.error("[support-notify] defer failed", row.id, error.message);
      errors.push(`${row.id}: defer failed ${error.message}`);
    }
  }
  return errors;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }
  if (!SUPABASE_URL || !DB_KEY) {
    return Response.json({ error: "Server misconfigured" }, { status: 500, headers: corsHeaders });
  }
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, DB_KEY);
  const startedAt = new Date().toISOString();

  try {
    const { data: recipients, error: recipientsError } = await admin
      .from("support_notification_recipients")
      .select("email")
      .eq("enabled", true);
    if (recipientsError) {
      return Response.json(
        { error: `recipients: ${recipientsError.message}` },
        { status: 500, headers: corsHeaders },
      );
    }
    const emails = (recipients ?? [])
      .map((row) => String(row.email ?? "").trim())
      .filter(Boolean);

    const { data: pending, error: pendingError } = await admin
      .from("support_notification_outbox")
      .select("id, kind, ticket_id, conversation_id, attempts")
      .is("sent_at", null)
      .lte("next_attempt_at", startedAt)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (pendingError) {
      return Response.json(
        { error: `outbox: ${pendingError.message}` },
        { status: 500, headers: corsHeaders },
      );
    }

    const rows = (pending ?? []) as OutboxRow[];
    const summary = {
      ok: true,
      found: rows.length,
      sent: 0,
      skipped: 0,
      retried: 0,
      deferred: 0,
      emails: emails.length,
      errors: [] as string[],
    };

    if (rows.length === 0) return Response.json(summary, { headers: corsHeaders });

    if (emails.length === 0) {
      // Nothing configured to send to. Keep the events: they go out as soon as
      // an address is added, and the 500 makes the misconfiguration visible in
      // the cron response history.
      const deferErrors = await deferBatch(admin, rows);
      summary.ok = false;
      summary.deferred = rows.length;
      summary.errors.push("no recipients configured", ...deferErrors);
      return Response.json(summary, { status: 500, headers: corsHeaders });
    }

    for (const row of rows) {
      // Claim with a compare-and-set so a concurrent tick cannot send the same row.
      const claimUntil = new Date(Date.now() + CLAIM_MINUTES * 60_000).toISOString();
      const { data: claimed, error: claimError } = await admin
        .from("support_notification_outbox")
        .update({ next_attempt_at: claimUntil })
        .eq("id", row.id)
        .is("sent_at", null)
        .lte("next_attempt_at", startedAt)
        .select("id")
        .maybeSingle();
      if (claimError) {
        summary.errors.push(`${row.id}: claim failed ${claimError.message}`);
        continue;
      }
      if (!claimed) continue;

      let email: Email | null = null;
      try {
        email = row.kind === "chat_queued"
          ? await buildChatEmail(admin, row)
          : await buildTicketEmail(admin, row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${row.id}: ${message}`);
        const markError = await markRetry(admin, row, `build: ${message}`);
        if (markError) summary.errors.push(`${row.id}: mark retry failed ${markError}`);
        summary.retried += 1;
        continue;
      }

      if (!email) {
        const markError = await markSkipped(admin, row.id, "target row no longer exists");
        if (markError) summary.errors.push(`${row.id}: mark skipped failed ${markError}`);
        summary.skipped += 1;
        continue;
      }

      let lastError = "";
      let delivered = 0;
      for (const to of emails) {
        const result = await sendResendEmail({
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          from: supportAlertFrom(),
          resendApiKey: RESEND_API_KEY,
          logPrefix: "[support-notify]",
        });
        if (result.ok) delivered += 1;
        else lastError = `resend failed for ${to}: ${result.error ?? "unknown error"}`;
      }

      // No recipient received it: retry. Some received it: close the row and
      // record who failed (retrying would duplicate the successful sends).
      if (delivered === 0) {
        const markError = await markRetry(admin, row, lastError || "no recipient received the email");
        if (markError) summary.errors.push(`${row.id}: mark retry failed ${markError}`);
        summary.retried += 1;
        summary.errors.push(`${row.id}: ${lastError || "no recipient received the email"}`);
        continue;
      }

      const note = lastError ? `${lastError} (delivered to ${delivered}/${emails.length})` : null;
      const markError = await markSent(admin, row.id, note);
      if (markError) summary.errors.push(`${row.id}: mark sent failed ${markError}`);
      summary.sent += 1;
    }

    return Response.json(summary, { headers: corsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[support-notify] run failed", message);
    return Response.json(
      { ok: false, error: message },
      { status: 500, headers: corsHeaders },
    );
  }
});
