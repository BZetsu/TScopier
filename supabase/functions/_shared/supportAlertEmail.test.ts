import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildSupportAlertEmail } from "./supportAlertEmail.ts";

Deno.test("ticket_created: subject names the ticket and the customer's subject", () => {
  const email = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#12",
    subject: "Trades not executed",
    customerLabel: "Ana",
    customerEmail: "ana@example.com",
    sourceLabel: "Signed-in user",
    locale: "es",
    status: "open",
    message: "My trades are not being copied since this morning.",
    createdAt: "2026-11-16T08:59:42Z",
  });

  assertEquals(email.subject, "New support ticket #12 — Trades not executed");
  assertStringIncludes(email.html, "New support ticket #12");
  assertStringIncludes(email.html, "ana@example.com");
  assertStringIncludes(email.html, "Signed-in user");
  assertStringIncludes(email.text, "My trades are not being copied");
});

Deno.test("ticket_reopened: says the ticket is open again", () => {
  const email = buildSupportAlertEmail({
    kind: "ticket_reopened",
    reference: "#9",
    subject: "Withdrawal pending",
    status: "resolved",
    message: "Still waiting on this.",
  });

  assertEquals(email.subject, "Support ticket reopened #9 — Withdrawal pending");
  assertStringIncludes(email.html, "open again");
});

Deno.test("chat_queued: subject does not pretend to be a ticket", () => {
  const email = buildSupportAlertEmail({
    kind: "chat_queued",
    reference: "#abcd1234",
    subject: "Live chat",
    customerLabel: "Guest",
    message: "Can I speak to a person?",
  });

  assertEquals(email.subject, "Customer waiting for a human — Live chat");
  assertStringIncludes(email.html, "asked for a human agent");
  assertEquals(email.html.includes("Open the ticket"), false);
});

Deno.test("customer content is escaped and the desk link is optional", () => {
  const withoutLink = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#3",
    subject: "<script>alert(1)</script>",
    message: "<b>bold</b> & \"quoted\"",
  });

  assertEquals(withoutLink.html.includes("<script>"), false);
  assertStringIncludes(withoutLink.html, "&lt;script&gt;");
  assertStringIncludes(withoutLink.html, "&amp;");
  assertEquals(withoutLink.html.includes("href="), false);

  const withLink = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#3",
    subject: "Help",
    deskUrl: "https://support.example.com/tickets?filter=open",
  });
  assertStringIncludes(withLink.html, "https://support.example.com/tickets?filter=open");
});

Deno.test("message is optional and never renders an empty block", () => {
  const email = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#4",
    subject: "Help",
    message: "   ",
  });
  assertEquals(email.html.includes("Customer message"), false);
});

Deno.test("headers stay on one line and only https links are used", () => {
  const email = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#5",
    subject: "Urgent\r\nBcc: someone@example.com",
    deskUrl: "javascript:alert(1)",
  });

  assertEquals(email.subject.includes("\n"), false);
  assertEquals(email.subject.includes("\r"), false);
  assertEquals(email.html.includes("javascript:"), false);
  assertEquals(email.html.includes("href="), false);

  const plain = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#6",
    subject: "It's broken",
  });
  assertStringIncludes(plain.html, "It&#39;s broken");
  // The plain-text part keeps readable punctuation.
  assertStringIncludes(plain.text, "It's broken");
});

Deno.test("plain text keeps a blank line between the heading and the details", () => {
  const email = buildSupportAlertEmail({
    kind: "ticket_created",
    reference: "#7",
    subject: "Help",
  });
  assertEquals(email.text.startsWith("New support ticket #7\n\n"), true);
});
