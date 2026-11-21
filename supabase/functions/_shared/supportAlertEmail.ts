/**
 * supportAlertEmail — the email the support team receives when a ticket needs
 * attention (new ticket, reopened ticket, or a live chat waiting for a human).
 *
 * Deliberately separate from the ops alert template in `alert-evaluator`: that
 * one is branded TScopier, links to the operations panel and is filtered by
 * severity. These are day-to-day support messages and always go to every
 * enabled support recipient.
 */

export type SupportAlertKind = "ticket_created" | "ticket_reopened" | "chat_queued";

export interface SupportAlertInput {
  kind: SupportAlertKind;
  /** Prefixed with # for tickets, a short id for chats. */
  reference: string;
  subject: string;
  /** "Signed-in user", "Guest", "Inbound email" — omitted for chats. */
  sourceLabel?: string | null;
  customerLabel?: string | null;
  customerEmail?: string | null;
  locale?: string | null;
  status?: string | null;
  /** The customer's message, already trimmed by the caller. */
  message?: string | null;
  /** Deep link into the support desk; omitted when not configured. */
  deskUrl?: string | null;
  createdAt?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Headers must never contain a raw line break. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function headline(kind: SupportAlertKind, reference: string): string {
  switch (kind) {
    case "ticket_created":
      return `New support ticket ${reference}`;
    case "ticket_reopened":
      return `Ticket ${reference} reopened`;
    case "chat_queued":
      return `Customer waiting for a human`;
  }
}

function leadSentence(kind: SupportAlertKind, subject: string): string {
  switch (kind) {
    case "ticket_created":
      return `A customer opened a new ticket: <strong>${escapeHtml(subject)}</strong>.`;
    case "ticket_reopened":
      return `A customer replied on a ticket that had been closed: <strong>${escapeHtml(subject)}</strong>. The ticket is open again.`;
    case "chat_queued":
      return `A customer asked for a human agent in live chat${
        subject ? `: <strong>${escapeHtml(subject)}</strong>` : ""
      }.`;
  }
}

function detailRow(label: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<tr>
    <td style="padding:2px 12px 2px 0;font-size:12px;color:#737373;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:2px 0;font-size:13px;color:#171717;">${escapeHtml(value)}</td>
  </tr>`;
}

export function buildSupportAlertEmail(input: SupportAlertInput): {
  subject: string;
  html: string;
  text: string;
} {
  const reference = input.reference;
  const heading = headline(input.kind, reference);
  const actionLabel = input.kind === "chat_queued" ? "Open the inbox" : "Open the ticket";

  const prefix =
    input.kind === "ticket_created"
      ? "New support ticket"
      : input.kind === "ticket_reopened"
        ? "Support ticket reopened"
        : "Customer waiting for a human";

  const subject = singleLine(
    input.kind === "chat_queued"
      ? `${prefix}${input.subject ? ` — ${input.subject}` : ""}`
      : `${prefix} ${reference} — ${input.subject}`,
  );

  // Only https links are ever put into the email.
  const deskUrl = /^https:\/\//i.test(input.deskUrl ?? "") ? input.deskUrl : null;
  const deskHref = deskUrl ? escapeHtml(singleLine(deskUrl)) : null;

  const details = [
    detailRow("Ticket", input.kind === "chat_queued" ? null : reference),
    detailRow("Status", input.status),
    detailRow("From", input.customerLabel),
    detailRow("Email", input.customerEmail),
    detailRow("Channel", input.sourceLabel),
    detailRow("Language", input.locale),
    detailRow("Received", input.createdAt),
  ].join("");

  const message = (input.message ?? "").trim();
  const messageBlock = message
    ? `<tr><td style="padding:16px 0 0 0;">
         <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#737373;">Customer message</p>
         <div style="padding:12px 14px;background:#f4f4f5;border-left:3px solid #22c55e;border-radius:6px;font-size:13px;line-height:1.55;color:#404040;white-space:pre-wrap;">${escapeHtml(message)}</div>
       </td></tr>`
    : "";

  const linkBlock = deskHref
    ? `<p style="margin:20px 0 0 0;"><a href="${deskHref}" style="font-size:14px;font-weight:600;color:#16a34a;text-decoration:none;">${actionLabel} &rarr;</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#4ade80;">UniCopier Support</p>
          <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:#171717;">${escapeHtml(heading)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 32px 32px;font-size:14px;line-height:1.6;color:#404040;">
          <p style="margin:0 0 12px 0;">${leadSentence(input.kind, input.subject)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">${details}</table>
          ${messageBlock}
          ${linkBlock}
          <p style="margin:20px 0 0 0;font-size:13px;color:#737373;">This message was sent automatically because someone needs a reply. Answer from the support desk, not by replying to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const detailLines: Array<string | null> = [
    input.kind === "ticket_created"
      ? `A customer opened a new ticket: ${input.subject}`
      : input.kind === "ticket_reopened"
        ? `A customer replied on a closed ticket: ${input.subject}. The ticket is open again.`
        : `A customer asked for a human agent${input.subject ? `: ${input.subject}` : ""}.`,
    input.kind === "chat_queued" ? null : `Ticket: ${reference}`,
    input.status ? `Status: ${input.status}` : null,
    input.customerLabel ? `From: ${input.customerLabel}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    input.sourceLabel ? `Channel: ${input.sourceLabel}` : null,
    input.locale ? `Language: ${input.locale}` : null,
    input.createdAt ? `Received: ${input.createdAt}` : null,
  ];

  const text = [
    heading,
    "",
    ...detailLines.filter((line): line is string => Boolean(line)),
    ...(message ? ["", "Customer message:", message] : []),
    ...(deskUrl ? ["", `${actionLabel}: ${deskUrl}`] : []),
    "",
    "This message was sent automatically because someone needs a reply. Answer from the support desk, not by replying to this email.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Alerts come from their own address, not from support@.
 *
 * support@ is the inbound ticket address: a staff auto-reply (vacation notice,
 * ticketing system) answering an alert that came from support@ would create a
 * new ticket, which would send another alert, and so on. Sending from
 * alerts@ and leaving reply-to unset keeps that loop closed.
 */
export function supportAlertFrom(): string {
  const explicit = Deno.env.get("SUPPORT_ALERT_FROM")?.trim();
  if (explicit) return explicit;
  return "UniCopier Alerts <alerts@unicopier.com>";
}
