import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

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
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { plan, interval, extraAccounts, successUrl, cancelUrl } = await req.json();

    if (!plan || !["basic", "advanced"].includes(plan)) {
      return new Response(
        JSON.stringify({ error: "Invalid plan" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const billingInterval = interval === "annual" ? "annual" : "monthly";

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Monthly price IDs
    const basicPriceId = Deno.env.get("STRIPE_BASIC_PRICE_ID")!;
    const advancedPriceId = Deno.env.get("STRIPE_ADVANCED_PRICE_ID")!;
    const extraAccountPriceId = Deno.env.get("STRIPE_EXTRA_ACCOUNT_PRICE_ID")!;

    // Annual price IDs (20% discount)
    const basicAnnualPriceId = Deno.env.get("STRIPE_BASIC_ANNUAL_PRICE_ID")!;
    const advancedAnnualPriceId = Deno.env.get("STRIPE_ADVANCED_ANNUAL_PRICE_ID")!;
    const extraAccountAnnualPriceId = Deno.env.get("STRIPE_EXTRA_ACCOUNT_ANNUAL_PRICE_ID")!;

    // Find or create Stripe customer
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, trial_ends_at, plan, status, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Persist customer id before Checkout completes so we can reconcile even if
      // the webhook is delayed or missing (e.g. staging without a Stripe endpoint).
      if (!existingSub) {
        await supabase.from("subscriptions").insert({
          user_id: user.id,
          stripe_customer_id: customerId,
          plan,
          status: "incomplete",
        });
      } else {
        await supabase
          .from("subscriptions")
          .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }
    }

    // Prevent stacking Basic on top of an already-active Advanced entitlement.
    // Users should manage upgrades/downgrades via Customer Portal / Billing.
    const existingPlan = existingSub?.plan;
    const existingStatus = existingSub?.status;
    const hasActiveAdvanced =
      existingPlan === "advanced" &&
      (existingStatus === "active" || existingStatus === "trialing" || existingStatus === "past_due");
    if (hasActiveAdvanced && plan === "basic") {
      return new Response(
        JSON.stringify({
          error:
            "You already have an active Advanced subscription. Manage billing from the customer portal instead of starting Basic.",
          code: "advanced_already_active",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (
      existingPlan === "basic" &&
      (existingStatus === "active" || existingStatus === "trialing" || existingStatus === "past_due") &&
      plan === "basic" &&
      existingSub?.stripe_subscription_id
    ) {
      return new Response(
        JSON.stringify({
          error:
            "You already have an active Basic subscription. Manage billing from the customer portal.",
          code: "basic_already_active",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build line items based on plan and interval
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (plan === "basic") {
      lineItems.push({
        price: billingInterval === "annual" ? basicAnnualPriceId : basicPriceId,
        quantity: 1,
      });
    } else {
      lineItems.push({
        price: billingInterval === "annual" ? advancedAnnualPriceId : advancedPriceId,
        quantity: 1,
      });
      const extra = Math.max(0, Math.min(95, Number(extraAccounts) || 0));
      if (extra > 0) {
        lineItems.push({
          price: billingInterval === "annual" ? extraAccountAnnualPriceId : extraAccountPriceId,
          quantity: extra,
        });
      }
    }

    const origin = req.headers.get("origin") || "http://localhost:5173";
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        supabase_user_id: user.id,
        plan,
        interval: billingInterval,
        extra_accounts: String(extraAccounts || 0),
      },
    };

    // Stripe replaces the literal `{CHECKOUT_SESSION_ID}` after payment.
    const rawSuccess = String(successUrl || `${origin}/dashboard?checkout=success`).trim();
    const successWithSession = rawSuccess.includes("{CHECKOUT_SESSION_ID}")
      ? rawSuccess
      : `${rawSuccess}${rawSuccess.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      payment_method_types: ["card"],
      payment_method_collection: "always",
      success_url: successWithSession,
      cancel_url: cancelUrl || `${origin}/pricing`,
      metadata: {
        supabase_user_id: user.id,
        plan,
        interval: billingInterval,
        extra_accounts: String(extraAccounts || 0),
      },
      subscription_data: subscriptionData,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      return new Response(
        JSON.stringify({ error: "Checkout session URL missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
