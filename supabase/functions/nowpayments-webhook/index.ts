import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  upsertMembershipCryptoEntitlement,
  type BillingInterval,
  type MembershipPlan,
} from "../_shared/membershipStripe.ts";
import { restoreCopierAccessOnSubscriptionActive } from "../_shared/subscriptionAccess.ts";
import {
  isNowPaymentsPaidStatus,
  verifyNowPaymentsIpnSignature,
  type NowPaymentsIpnPayload,
} from "../_shared/nowpayments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-nowpayments-sig",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ipnSecret = Deno.env.get("NOWPAYMENTS_IPN_SECRET");
  if (!ipnSecret) {
    return new Response(JSON.stringify({ error: "IPN secret not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawText = await req.text();
  let body: NowPaymentsIpnPayload;
  try {
    body = JSON.parse(rawText) as NowPaymentsIpnPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signature = req.headers.get("x-nowpayments-sig");
  const ok = await verifyNowPaymentsIpnSignature(
    body as Record<string, unknown>,
    signature,
    ipnSecret,
  );
  if (!ok) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) {
    return new Response(JSON.stringify({ received: true, note: "no order_id" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: invoice, error: invErr } = await supabase
    .from("crypto_invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ error: "Unknown order_id" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const paymentStatus = String(body.payment_status ?? "").toLowerCase();
  const mergedRaw = {
    ...(typeof invoice.raw === "object" && invoice.raw ? invoice.raw : {}),
    last_ipn: body,
  };

  if (paymentStatus === "failed" || paymentStatus === "expired") {
    if (invoice.status === "pending") {
      await supabase
        .from("crypto_invoices")
        .update({
          status: paymentStatus === "expired" ? "expired" : "failed",
          raw: mergedRaw,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id);
    }
    return new Response(JSON.stringify({ received: true, status: paymentStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isNowPaymentsPaidStatus(paymentStatus)) {
    await supabase
      .from("crypto_invoices")
      .update({ raw: mergedRaw, updated_at: new Date().toISOString() })
      .eq("id", invoice.id);
    return new Response(JSON.stringify({ received: true, status: paymentStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Idempotent: already finished
  if (invoice.status === "finished") {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const plan = invoice.plan as MembershipPlan;
  const billingInterval = invoice.billing_interval as BillingInterval;
  const extraAccounts = Number(invoice.extra_accounts ?? 0) || 0;
  const customerId =
    (mergedRaw as { stripe_customer_id?: string }).stripe_customer_id ?? null;

  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("current_period_end, stripe_customer_id")
    .eq("user_id", invoice.user_id)
    .maybeSingle();

  await upsertMembershipCryptoEntitlement({
    supabase,
    userId: invoice.user_id,
    customerId: customerId || existingSub?.stripe_customer_id || null,
    plan,
    billingInterval,
    extraAccounts,
    existingPeriodEnd: existingSub?.current_period_end ?? null,
  });
  await restoreCopierAccessOnSubscriptionActive(supabase, invoice.user_id);

  await supabase
    .from("crypto_invoices")
    .update({
      status: "finished",
      provider_invoice_id:
        String(body.invoice_id ?? invoice.provider_invoice_id ?? "").trim() ||
        invoice.provider_invoice_id,
      raw: mergedRaw,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id);

  return new Response(JSON.stringify({ received: true, granted: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
