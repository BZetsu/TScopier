import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  stripePriceIdsFromEnv,
  subscriptionRowFromStripe,
  mapStripeSubscriptionStatus,
} from "../_shared/stripeSubscriptionSync.ts";
import { DEFAULT_AFFILIATE_COMMISSION_RATE } from "../_shared/affiliate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function resolveUserIdFromSubscription(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const metaUserId = subscription.metadata?.supabase_user_id;
  if (metaUserId) return metaUserId;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;
  if (!customerId) return null;

  const customer =
    typeof subscription.customer === "object" && subscription.customer
      ? subscription.customer
      : await stripe.customers.retrieve(customerId);
  if (!customer.deleted && customer.metadata?.supabase_user_id) {
    return customer.metadata.supabase_user_id;
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  return data?.user_id ?? null;
}

function resolveInvoiceServicePeriod(
  invoice: Stripe.Invoice,
): { periodStart: string | null; periodEnd: string | null } {
  const lines = invoice.lines?.data ?? [];
  const subscriptionLines = lines.filter((line) =>
    line.type === "subscription" || (line.subscription != null && line.proration !== true)
  );
  const candidates = subscriptionLines.length > 0 ? subscriptionLines : lines;

  let start: number | null = null;
  let end: number | null = null;
  for (const line of candidates) {
    const ps = line.period?.start;
    const pe = line.period?.end;
    if (ps == null || pe == null) continue;
    if (start == null || ps < start) start = ps;
    if (end == null || pe > end) end = pe;
  }
  if (start == null || end == null) {
    start = invoice.period_start ?? null;
    end = invoice.period_end ?? null;
  }
  return {
    periodStart: start != null ? new Date(start * 1000).toISOString() : null,
    periodEnd: end != null ? new Date(end * 1000).toISOString() : null,
  };
}

async function accrueInvoiceCommission(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
): Promise<void> {
  if (!invoice.id) return;
  const amountPaid = Number(invoice.amount_paid ?? 0);
  if (amountPaid <= 0) return;
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (!subscriptionId) return;

  const { data: existingRow } = await supabase
    .from("commission_ledger")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();
  if (existingRow) return;

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  const referredUserId = subRow?.user_id ?? null;
  if (!referredUserId) return;

  const { data: attribution } = await supabase
    .from("referral_attributions")
    .select("affiliate_user_id")
    .eq("referred_user_id", referredUserId)
    .maybeSingle();
  const affiliateUserId = attribution?.affiliate_user_id ?? null;
  if (!affiliateUserId) return;
  const { data: affiliateProfile } = await supabase
    .from("affiliate_profiles")
    .select("stripe_connect_account_id")
    .eq("user_id", affiliateUserId)
    .maybeSingle();

  const commissionCents = Math.round(amountPaid * DEFAULT_AFFILIATE_COMMISSION_RATE);
  if (commissionCents <= 0) return;
  const shouldAutoPayout = Deno.env.get("AFFILIATE_CONNECT_AUTOPAYOUT") === "true" &&
    Boolean(affiliateProfile?.stripe_connect_account_id);
  let status: "pending" | "paid" = "pending";

  if (shouldAutoPayout) {
    try {
      await stripe.transfers.create({
        amount: commissionCents,
        currency: String(invoice.currency ?? "usd"),
        destination: String(affiliateProfile?.stripe_connect_account_id),
        transfer_group: subscriptionId,
        description: `Affiliate commission for invoice ${invoice.id}`,
        metadata: {
          stripe_invoice_id: invoice.id,
          affiliate_user_id: affiliateUserId,
          referred_user_id: referredUserId,
        },
      });
      status = "paid";
    } catch (err) {
      console.warn(
        `[stripe-webhook] affiliate transfer failed for invoice ${invoice.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const period = resolveInvoiceServicePeriod(invoice);
  await supabase
    .from("commission_ledger")
    .insert({
      affiliate_user_id: affiliateUserId,
      referred_user_id: referredUserId,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      invoice_amount_cents: amountPaid,
      commission_rate: DEFAULT_AFFILIATE_COMMISSION_RATE,
      commission_cents: commissionCents,
      currency: invoice.currency ?? "usd",
      status,
      period_start: period.periodStart,
      period_end: period.periodEnd,
    });
}

async function reverseInvoiceCommission(
  supabase: ReturnType<typeof createClient>,
  invoiceId: string | null,
): Promise<void> {
  if (!invoiceId) return;
  await supabase
    .from("commission_ledger")
    .update({ status: "reversed" })
    .eq("stripe_invoice_id", invoiceId)
    .in("status", ["pending", "approved", "paid"]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const priceIds = stripePriceIdsFromEnv(Deno.env);

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Webhook signature verification failed: ${err instanceof Error ? err.message : "unknown"}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingEvent } = await supabase
      .from("stripe_events")
      .select("event_id")
      .eq("event_id", event.id)
      .maybeSingle();

    if (existingEvent) {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("stripe_events")
      .insert({ event_id: event.id, event_type: event.type });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

        if (userId && session.subscription && customerId) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string,
            { expand: ["items.data.price"] },
          );

          await supabase
            .from("subscriptions")
            .upsert(
              subscriptionRowFromStripe(subscription, userId, customerId, priceIds),
              { onConflict: "user_id", ignoreDuplicates: false },
            );
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdFromSubscription(stripe, subscription, supabase);
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id ?? null;

        if (userId && customerId) {
          await supabase
            .from("subscriptions")
            .upsert(
              subscriptionRowFromStripe(subscription, userId, customerId, priceIds),
              { onConflict: "user_id", ignoreDuplicates: false },
            );
        } else if (userId) {
          await supabase
            .from("subscriptions")
            .update({
              status: mapStripeSubscriptionStatus(subscription.status),
              current_period_end: new Date(
                subscription.current_period_end * 1000,
              ).toISOString(),
              trial_ends_at: subscription.trial_end
                ? new Date(subscription.trial_end * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdFromSubscription(stripe, subscription, supabase);

        if (userId) {
          await supabase
            .from("subscriptions")
            .update({
              status: "canceled",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string | null;

        if (subscriptionId) {
          await supabase
            .from("subscriptions")
            .update({
              status: "past_due",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subscriptionId);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id ?? null;
        if (subscriptionId) {
          await supabase
            .from("subscriptions")
            .update({
              status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subscriptionId);
        }
        await accrueInvoiceCommission(stripe, supabase, invoice);
        break;
      }

      case "invoice.voided": {
        const invoice = event.data.object as Stripe.Invoice;
        await reverseInvoiceCommission(supabase, invoice.id ?? null);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const invoiceId = typeof charge.invoice === "string"
          ? charge.invoice
          : charge.invoice?.id ?? null;
        await reverseInvoiceCommission(supabase, invoiceId);
        break;
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
