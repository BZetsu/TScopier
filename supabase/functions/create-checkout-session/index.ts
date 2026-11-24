import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  buildMembershipLineItems,
  ensureStripeCustomer,
  guardExistingMembership,
  membershipMetadata,
  resolvePromotionCodeId,
  stripeApiVersion,
  type BillingInterval,
  type MembershipPlan,
} from "../_shared/membershipStripe.ts";

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
    const paymentMethod = String(body.paymentMethod ?? "crypto").toLowerCase();
    const promotionCode =
      typeof body.promotionCode === "string" ? body.promotionCode : undefined;
    const extraAccounts = body.extraAccounts;
    const successUrl = body.successUrl;
    const cancelUrl = body.cancelUrl;

    if (!plan || !["basic", "advanced"].includes(plan)) {
      return new Response(
        JSON.stringify({ error: "Invalid plan" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Hosted Checkout from the new UI is crypto-only; card uses Elements.
    if (paymentMethod !== "crypto") {
      return new Response(
        JSON.stringify({
          error: "Use the in-app card checkout for card payments",
          code: "card_use_elements",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const billingInterval: BillingInterval = body.interval === "annual" ? "annual" : "monthly";
    const stripe = new Stripe(stripeKey, { apiVersion: stripeApiVersion });

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

    const customerId = await ensureStripeCustomer({
      stripe,
      supabase,
      user,
      existingSub,
      plan,
    });

    const promo = await resolvePromotionCodeId(stripe, promotionCode);
    if (promo.error) {
      return new Response(
        JSON.stringify({ error: promo.error, code: "invalid_promotion_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lineItems = buildMembershipLineItems(
      plan,
      billingInterval,
      Number(extraAccounts) || 0,
    );
    const meta = membershipMetadata(user.id, plan, billingInterval, Number(extraAccounts) || 0);

    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: meta,
    };
    if (plan === "advanced" && !existingSub?.trial_ends_at) {
      subscriptionData.trial_period_days = 5;
      subscriptionData.trial_settings = {
        end_behavior: { missing_payment_method: "create_invoice" },
      };
    }

    const origin = req.headers.get("origin") || "http://localhost:5173";
    const rawSuccess = String(successUrl || `${origin}/dashboard?checkout=success`).trim();
    const successWithSession = rawSuccess.includes("{CHECKOUT_SESSION_ID}")
      ? rawSuccess
      : `${rawSuccess}${rawSuccess.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      payment_method_types: ["crypto"],
      payment_method_collection: "always",
      success_url: successWithSession,
      cancel_url: cancelUrl || `${origin}/pricing`,
      metadata: meta,
      subscription_data: subscriptionData,
      allow_promotion_codes: !promo.promotionCodeId,
    };
    if (promo.promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: promo.promotionCodeId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      return new Response(
        JSON.stringify({ error: "Checkout session URL missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
