import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** Service period the customer paid for — from subscription line items, not invoice accrual window. */
function resolveInvoiceServicePeriod(inv: Stripe.Invoice): {
  start: number | null;
  end: number | null;
} {
  const lines = inv.lines?.data ?? [];
  const subscriptionLines = lines.filter(
    (line) =>
      line.type === "subscription"
      || (line.subscription != null && line.proration !== true),
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
    return {
      start: inv.period_start ?? null,
      end: inv.period_end ?? null,
    };
  }

  return { start, end };
}

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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const startingAfter = typeof body.startingAfter === "string" ? body.startingAfter : undefined;
    const limit = Math.min(20, Math.max(1, Number(body.limit) || 10));

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!subscription?.stripe_customer_id) {
      return new Response(
        JSON.stringify({
          invoices: [],
          hasMore: false,
          customerId: null,
          balance: 0,
          billingInterval: null,
          currentPeriodAmount: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    const [customer, invoiceList] = await Promise.all([
      stripe.customers.retrieve(subscription.stripe_customer_id),
      stripe.invoices.list({
        customer: subscription.stripe_customer_id,
        limit,
        starting_after: startingAfter,
        expand: ["data.lines.data"],
      }),
    ]);

    const balanceCents = typeof customer === "object" && !customer.deleted
      ? customer.balance ?? 0
      : 0;

    let billingInterval: "monthly" | "annual" | null = null;
    let currentPeriodAmount: number | null = null;

    if (subscription.stripe_subscription_id) {
      const stripeSub = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
        { expand: ["items.data.price"] },
      );
      const recurring = stripeSub.items.data[0]?.price?.recurring;
      if (recurring?.interval === "year") billingInterval = "annual";
      else if (recurring?.interval === "month") billingInterval = "monthly";

      currentPeriodAmount = stripeSub.items.data.reduce((sum, item) => {
        const unit = item.price?.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        return sum + unit * qty;
      }, 0);
    }

    const invoices = invoiceList.data.map((inv) => {
      const { start, end } = resolveInvoiceServicePeriod(inv);
      return {
        id: inv.id,
        number: inv.number,
        periodStart: start != null ? new Date(start * 1000).toISOString() : null,
        periodEnd: end != null ? new Date(end * 1000).toISOString() : null,
        created: new Date(inv.created * 1000).toISOString(),
        amountPaid: inv.amount_paid ?? 0,
        currency: inv.currency ?? "usd",
        status: inv.status ?? "draft",
        pdfUrl: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
      };
    });

    return new Response(
      JSON.stringify({
        invoices,
        hasMore: invoiceList.has_more,
        customerId: subscription.stripe_customer_id,
        balance: balanceCents,
        billingInterval,
        currentPeriodAmount,
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
