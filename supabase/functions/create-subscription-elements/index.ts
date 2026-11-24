import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  buildSubscriptionItems,
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

function bad(status: number, message: string, code?: string) {
  return Response.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return bad(500, "Stripe not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return bad(401, "Missing authorization");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return bad(401, "Unauthorized");

    const body = await req.json();
    const plan = body.plan as MembershipPlan;
    if (!plan || !["basic", "advanced"].includes(plan)) return bad(400, "Invalid plan");

    const billingInterval: BillingInterval = body.interval === "annual" ? "annual" : "monthly";
    const extraAccounts = Math.max(0, Math.min(95, Number(body.extraAccounts) || 0));
    const promotionCode =
      typeof body.promotionCode === "string" ? body.promotionCode : undefined;

    const stripe = new Stripe(stripeKey, { apiVersion: stripeApiVersion });

    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, trial_ends_at, plan, status, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const guard = guardExistingMembership(existingSub, plan);
    if (guard) return bad(409, guard.message, guard.code);

    const customerId = await ensureStripeCustomer({
      stripe,
      supabase,
      user,
      existingSub,
      plan,
    });

    const promo = await resolvePromotionCodeId(stripe, promotionCode);
    if (promo.error) return bad(400, promo.error, "invalid_promotion_code");

    const meta = membershipMetadata(user.id, plan, billingInterval, extraAccounts);
    const items = buildSubscriptionItems(plan, billingInterval, extraAccounts);

    const createParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items,
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      metadata: meta,
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
    };

    if (promo.promotionCodeId) {
      createParams.discounts = [{ promotion_code: promo.promotionCodeId }];
    }

    if (plan === "advanced" && !existingSub?.trial_ends_at) {
      createParams.trial_period_days = 5;
      createParams.trial_settings = {
        end_behavior: { missing_payment_method: "create_invoice" },
      };
    }

    const subscription = await stripe.subscriptions.create(createParams);

    const invoice = subscription.latest_invoice;
    const paymentIntent =
      invoice && typeof invoice !== "string"
        ? typeof invoice.payment_intent === "string"
          ? null
          : invoice.payment_intent
        : null;
    const setupIntent =
      typeof subscription.pending_setup_intent === "string"
        ? null
        : subscription.pending_setup_intent;

    const clientSecret =
      paymentIntent?.client_secret ?? setupIntent?.client_secret ?? null;
    if (!clientSecret) {
      return bad(500, "No client secret available for payment confirmation");
    }

    const intentType = paymentIntent?.client_secret
      ? "payment"
      : setupIntent?.client_secret
        ? "setup"
        : "payment";

    return Response.json(
      {
        clientSecret,
        subscriptionId: subscription.id,
        intentType,
        status: subscription.status,
      },
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return bad(500, err instanceof Error ? err.message : "Unknown error");
  }
});
