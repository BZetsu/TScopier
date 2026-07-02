import type Stripe from "npm:stripe@17";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildAuthEmailHtml } from "./authEmailLayout.ts";
import { resolveEmailLogoUrl } from "./brandEmailAssets.ts";
import { revokeCopierAccessOnSubscriptionEnd } from "./subscriptionAccess.ts";

export type InvoicePaymentIssueKind = "failed" | "action_required";

const COPY: Record<
  InvoicePaymentIssueKind,
  { subject: string; title: string; body: string; button: string; footer: string }
> = {
  action_required: {
    subject: "Action required — confirm your TScopier subscription payment",
    title: "Confirm your payment",
    body:
      "Your bank requires additional verification to complete your TScopier subscription payment. Signal copying is paused until payment is confirmed.",
    button: "Complete payment",
    footer:
      "If you did not expect this charge, contact your bank or reply to this email. You can also update your payment method from Billing in the app.",
  },
  failed: {
    subject: "Payment failed — update your TScopier subscription",
    title: "Payment failed",
    body:
      "We could not process your latest TScopier subscription payment. Signal copying is paused until your billing is updated.",
    button: "Pay invoice",
    footer:
      "Update your card from the link above or open Billing in the app. Reply to this email if you need help.",
  },
};

export async function handleInvoicePaymentIssue(
  stripe: Stripe,
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  kind: InvoicePaymentIssueKind,
): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (!subscriptionId) return;

  await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  const userId = subRow?.user_id as string | undefined;
  if (!userId) return;

  await revokeCopierAccessOnSubscriptionEnd(supabase, userId);
  await sendPaymentIssueEmail(stripe, supabase, invoice, userId, kind);
}

async function sendPaymentIssueEmail(
  stripe: Stripe,
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  userId: string,
  kind: InvoicePaymentIssueKind,
): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("[billingPaymentNotification] RESEND_API_KEY missing; skipping email");
    return;
  }

  let hostedUrl = invoice.hosted_invoice_url ?? null;
  if (!hostedUrl && invoice.id) {
    try {
      const full = await stripe.invoices.retrieve(invoice.id);
      hostedUrl = full.hosted_invoice_url ?? null;
    } catch (err) {
      console.warn(
        `[billingPaymentNotification] invoice retrieve failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const appUrl = (Deno.env.get("VITE_APP_URL") || "https://app.tscopier.ai").replace(
    /\/$/,
    "",
  );
  const paymentUrl = hostedUrl || `${appUrl}/billing`;

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? invoice.customer_email ?? null;
  if (!email) return;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("first_name, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  const firstName = profile?.first_name?.trim()
    || profile?.display_name?.trim()?.split(/\s+/)[0]
    || "there";

  const copy = COPY[kind];
  const logoUrl = resolveEmailLogoUrl({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    appUrl,
    variant: "light",
    explicitUrl: Deno.env.get("EMAIL_LOGO_URL"),
  });

  const html = buildAuthEmailHtml({
    title: copy.title,
    greeting: `Hello ${firstName},`,
    bodyHtml: `<p style="margin:0;">${copy.body}</p>`,
    buttonLabel: copy.button,
    buttonUrl: paymentUrl,
    footerNote: copy.footer,
    logoUrl,
  });

  const from = Deno.env.get("RESEND_BILLING_FROM")
    || Deno.env.get("RESEND_CAMPAIGN_FROM")
    || "TScopier <noreply@tscopier.ai>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: copy.subject,
        html,
      }),
    });
    if (!res.ok) {
      console.warn(
        "[billingPaymentNotification] Resend error:",
        await res.text(),
      );
    }
  } catch (err) {
    console.warn(
      `[billingPaymentNotification] send failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
