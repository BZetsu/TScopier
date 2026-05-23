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

    const { extraAccounts } = await req.json();
    const newCount = Math.max(0, Math.min(95, Number(extraAccounts) || 0));

    // Get current subscription
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!subscription || !subscription.stripe_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (subscription.plan !== "advanced") {
      return new Response(
        JSON.stringify({ error: "Extra accounts are only available on the Advanced plan" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Retrieve the current Stripe subscription
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

    // Find the extra-account line item (the one that is not the base plan)
    const extraAccountPriceId = Deno.env.get("STRIPE_EXTRA_ACCOUNT_PRICE_ID")!;
    const extraAccountAnnualPriceId = Deno.env.get("STRIPE_EXTRA_ACCOUNT_ANNUAL_PRICE_ID")!;

    const existingExtraItem = stripeSub.items.data.find(
      (item) =>
        item.price.id === extraAccountPriceId ||
        item.price.id === extraAccountAnnualPriceId
    );

    const items: Stripe.SubscriptionUpdateParams.Item[] = [];

    if (newCount === 0 && existingExtraItem) {
      // Remove the extra-account line item
      items.push({ id: existingExtraItem.id, deleted: true });
    } else if (newCount > 0 && existingExtraItem) {
      // Update quantity on existing line item
      items.push({ id: existingExtraItem.id, quantity: newCount });
    } else if (newCount > 0 && !existingExtraItem) {
      // Determine which price to use based on billing interval
      const isAnnual = stripeSub.items.data.some(
        (item) => item.price.recurring?.interval === "year"
      );
      items.push({
        price: isAnnual ? extraAccountAnnualPriceId : extraAccountPriceId,
        quantity: newCount,
      });
    }

    if (items.length > 0) {
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        items,
        proration_behavior: "create_prorations",
        metadata: {
          ...stripeSub.metadata,
          extra_accounts: String(newCount),
        },
      });
    }

    // Update local record
    await supabase
      .from("subscriptions")
      .update({ extra_accounts: newCount, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({ extraAccounts: newCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
