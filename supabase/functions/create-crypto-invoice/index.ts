import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  ensureStripeCustomer,
  guardExistingMembership,
  resolveMembershipAmountUsd,
  stripeApiVersion,
  type BillingInterval,
  type MembershipPlan,
} from "../_shared/membershipStripe.ts";
import { createNowPaymentsInvoice } from "../_shared/nowpayments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const npApiKey = Deno.env.get("NOWPAYMENTS_API_KEY");
    if (!npApiKey) {
      return new Response(
        JSON.stringify({ error: "NOWPayments not configured (NOWPAYMENTS_API_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured (price source)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const plan = body.plan as MembershipPlan;
    const billingInterval: BillingInterval =
      body.interval === "annual" ? "annual" : "monthly";
    const extraAccounts =
      plan === "advanced" ? Math.max(0, Math.min(95, Number(body.extraAccounts) || 0)) : 0;
    const successUrl = body.successUrl;
    const cancelUrl = body.cancelUrl;

    if (!plan || !["basic", "advanced"].includes(plan)) {
      return new Response(
        JSON.stringify({ error: "Invalid plan" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, trial_ends_at, plan, status, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const guard = guardExistingMembership(existingSub, plan);
    if (guard) {
      return new Response(
        JSON.stringify({ error: guard.message, code: guard.code }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: stripeApiVersion });
    const customerId = await ensureStripeCustomer({
      stripe,
      supabase,
      user,
      existingSub,
      plan,
    });

    const amountUsd = await resolveMembershipAmountUsd(
      stripe,
      plan,
      billingInterval,
      extraAccounts,
    );

    const orderId = `np_${crypto.randomUUID().replace(/-/g, "")}`;
    const origin = req.headers.get("origin") || "http://localhost:5173";
    const rawSuccess = String(
      successUrl || `${origin}/dashboard?checkout=success`,
    ).trim();
    const successWithOrder = rawSuccess.includes("{ORDER_ID}")
      ? rawSuccess.replaceAll("{ORDER_ID}", orderId)
      : `${rawSuccess}${rawSuccess.includes("?") ? "&" : "?"}crypto_invoice=${encodeURIComponent(orderId)}`;

    const ipnCallbackUrl =
      Deno.env.get("NOWPAYMENTS_IPN_URL")?.trim() ||
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/nowpayments-webhook`;

    const { data: invoiceRow, error: insertErr } = await supabase
      .from("crypto_invoices")
      .insert({
        user_id: user.id,
        provider: "nowpayments",
        order_id: orderId,
        plan,
        billing_interval: billingInterval,
        extra_accounts: extraAccounts,
        amount_usd: amountUsd,
        status: "pending",
        raw: { stripe_customer_id: customerId },
      })
      .select("id")
      .single();

    if (insertErr || !invoiceRow) {
      return new Response(
        JSON.stringify({ error: insertErr?.message || "Failed to create invoice row" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let npInvoice;
    try {
      npInvoice = await createNowPaymentsInvoice({
        apiKey: npApiKey,
        priceAmountUsd: amountUsd,
        orderId,
        orderDescription: `UniCopier ${plan} (${billingInterval})`,
        successUrl: successWithOrder,
        cancelUrl: cancelUrl || `${origin}/billing`,
        ipnCallbackUrl,
      });
    } catch (err) {
      await supabase
        .from("crypto_invoices")
        .update({
          status: "failed",
          raw: { stripe_customer_id: customerId, error: String(err) },
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceRow.id);
      throw err;
    }

    const providerInvoiceId = String(
      npInvoice.id ?? npInvoice.invoice_id ?? "",
    ).trim() || null;

    await supabase
      .from("crypto_invoices")
      .update({
        provider_invoice_id: providerInvoiceId,
        raw: { stripe_customer_id: customerId, nowpayments: npInvoice },
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceRow.id);

    return new Response(
      JSON.stringify({
        url: npInvoice.invoice_url,
        orderId,
        invoiceId: providerInvoiceId,
        amountUsd,
        provider: "nowpayments",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
