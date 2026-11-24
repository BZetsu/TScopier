import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  ensureStripeCustomer,
  stripeApiVersion,
  type MembershipPlan,
} from "../_shared/membershipStripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function bad(status: number, message: string) {
  return Response.json(
    { error: message },
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

    const stripe = new Stripe(stripeKey, { apiVersion: stripeApiVersion });
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, trial_ends_at, plan, status, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const plan = (existingSub?.plan === "advanced" ? "advanced" : "basic") as MembershipPlan;
    const customerId = await ensureStripeCustomer({
      stripe,
      supabase,
      user,
      existingSub,
      plan,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { supabase_user_id: user.id },
    });

    if (!setupIntent.client_secret) return bad(500, "SetupIntent client secret missing");

    return Response.json(
      { clientSecret: setupIntent.client_secret },
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return bad(500, err instanceof Error ? err.message : "Unknown error");
  }
});
