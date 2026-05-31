import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  affiliateCorsHeaders,
  createUniqueReferralCode,
  requireAuthedUser,
} from "../_shared/affiliate.ts";

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, {
    status,
    headers: affiliateCorsHeaders,
  });
}

async function ensureAffiliateProfile(
  supabase: ReturnType<typeof createClient>,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) {
  const existingRes = await supabase
    .from("affiliate_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingRes.error) throw new Error(existingRes.error.message);
  if (existingRes.data) return existingRes.data;

  const referralCode = await createUniqueReferralCode(
    supabase,
    user as unknown as Parameters<typeof createUniqueReferralCode>[1],
  );
  const insertRes = await supabase
    .from("affiliate_profiles")
    .insert({
      user_id: user.id,
      referral_code: referralCode,
      is_active: true,
    })
    .select("*")
    .single();
  if (insertRes.error) throw new Error(insertRes.error.message);
  return insertRes.data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: affiliateCorsHeaders });
  }
  if (req.method !== "GET" && req.method !== "PATCH") {
    return bad(405, "Method not allowed");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const auth = await requireAuthedUser(req, supabase);
    if ("error" in auth) return auth.error;
    const user = auth.user;

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const payoutEmailRaw = String(body.payout_email ?? "").trim();
      const payoutEmail = payoutEmailRaw.length > 0 ? payoutEmailRaw : null;
      const { error } = await supabase
        .from("affiliate_profiles")
        .update({ payout_email: payoutEmail })
        .eq("user_id", user.id);
      if (error) return bad(400, error.message);
    }

    const profile = await ensureAffiliateProfile(supabase, user);
    const referredRes = await supabase
      .from("referral_attributions")
      .select("referred_user_id, referral_code, attribution_source, created_at")
      .eq("affiliate_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (referredRes.error) return bad(400, referredRes.error.message);
    const referredRows = referredRes.data ?? [];

    const referredIds = referredRows.map((r) => r.referred_user_id);
    let activeReferrals = 0;
    if (referredIds.length > 0) {
      const activeRes = await supabase
        .from("subscriptions")
        .select("user_id", { count: "exact", head: true })
        .in("user_id", referredIds)
        .in("status", ["active", "trialing"]);
      activeReferrals = activeRes.count ?? 0;
    }

    const commRes = await supabase
      .from("commission_ledger")
      .select("*")
      .eq("affiliate_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (commRes.error) return bad(400, commRes.error.message);
    const commissions = commRes.data ?? [];

    const totals = commissions.reduce((acc, row) => {
      const cents = Number(row.commission_cents ?? 0) || 0;
      if (row.status === "paid") acc.paid += cents;
      else if (row.status === "reversed") acc.reversed += cents;
      else if (row.status === "pending" || row.status === "approved") acc.pending += cents;
      acc.earned += cents;
      return acc;
    }, { earned: 0, pending: 0, paid: 0, reversed: 0 });

    const referralLookup = new Set(referredIds);
    const profileRows = referralLookup.size > 0
      ? await supabase
        .from("user_profiles")
        .select("user_id,display_name,first_name,last_name")
        .in("user_id", [...referralLookup])
      : { data: [], error: null };
    if (profileRows.error) return bad(400, profileRows.error.message);
    const namesByUser = new Map<string, string>();
    for (const row of profileRows.data ?? []) {
      const first = String(row.first_name ?? "").trim();
      const last = String(row.last_name ?? "").trim();
      const display = String(row.display_name ?? "").trim();
      const name = [first, last].filter(Boolean).join(" ").trim() || display || "User";
      namesByUser.set(row.user_id, name);
    }

    const appBase = Deno.env.get("APP_URL") || req.headers.get("origin") || "https://app.tscopier.ai";
    return Response.json({
      profile,
      referral_link: `${appBase.replace(/\/+$/, "")}/signup?ref=${encodeURIComponent(profile.referral_code)}`,
      stats: {
        total_referrals: referredRows.length,
        active_referrals: activeReferrals,
        total_earned_cents: totals.earned,
        pending_cents: totals.pending,
        paid_cents: totals.paid,
        reversed_cents: totals.reversed,
      },
      referrals: referredRows.map((r) => ({
        ...r,
        referred_user_name: namesByUser.get(r.referred_user_id) ?? "User",
      })),
      commissions,
    }, { headers: affiliateCorsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return bad(500, message);
  }
});

