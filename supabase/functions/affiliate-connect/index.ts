import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { affiliateCorsHeaders, requireAuthedUser } from "../_shared/affiliate.ts";

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: affiliateCorsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: affiliateCorsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return bad(500, "Stripe not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const auth = await requireAuthedUser(req, supabase);
    if ("error" in auth) return auth.error;
    const user = auth.user;

    const existing = await supabase
      .from("affiliate_profiles")
      .select("stripe_connect_account_id,referral_code")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing.error) return bad(400, existing.error.message);

    let accountId = existing.data?.stripe_connect_account_id ?? null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: user.email ?? undefined,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          supabase_user_id: user.id,
          referral_code: existing.data?.referral_code ?? "",
        },
      });
      accountId = account.id;
      await supabase
        .from("affiliate_profiles")
        .update({ stripe_connect_account_id: accountId })
        .eq("user_id", user.id);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://app.tscopier.ai";
    const refreshUrl = String(body.refresh_url ?? `${origin}/affiliate-program`)
      .trim();
    const returnUrl = String(body.return_url ?? `${origin}/affiliate-program`)
      .trim();

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: refreshUrl,
      return_url: returnUrl,
    });
    return Response.json({ url: link.url }, { headers: affiliateCorsHeaders });
  } catch (err) {
    return bad(500, err instanceof Error ? err.message : "Unknown error");
  }
});

