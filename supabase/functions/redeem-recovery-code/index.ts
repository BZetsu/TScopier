import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuthedUser } from "../_shared/affiliate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

/** Fallback when a code row somehow has no usable `days` (the column is
 * NOT NULL with a 1..30 CHECK, so this is defensive only). */
const FALLBACK_GRANT_DAYS = 14;

/** Reasons a billing-driven pause may be cleared when access is restored. */
const RESTARTABLE_PAUSE_REASONS = [
  "trial_expired",
  "subscription_ended",
  "payment_failed",
  "unknown",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await requireAuthedUser(req, supabase);
    if ("error" in auth) return auth.error;
    const user = auth.user;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const code = String(body.code ?? "").trim();
    if (!code) return bad(400, "code is required");

    // Find an unused code. The code is tied to one user; the caller must be that
    // user, so codes cannot be shared or redeemed by another account.
    // `days` is read here because it is what gets granted: the admin's Days
    // choice, the 30-day cap and the email text all key off this same column,
    // so hardcoding a duration would let them disagree.
    const { data: existing, error: findErr } = await supabase
      .from("subscription_recovery_codes")
      .select("id, user_id, expires_at, days")
      .eq("code", code)
      .eq("used", false)
      .maybeSingle();
    if (findErr) return bad(400, findErr.message);
    if (!existing) {
      return bad(404, "Recovery code not found or already used");
    }
    if (String(existing.user_id) !== user.id) {
      return bad(403, "This code was issued to a different account");
    }
    if (
      existing.expires_at &&
      new Date(existing.expires_at).getTime() <= Date.now()
    ) {
      return bad(410, "This recovery code has expired");
    }

    const now = new Date().toISOString();
    const grantDays = Number(existing.days) > 0 ? Number(existing.days) : FALLBACK_GRANT_DAYS;

    // Grant the access extension first, then flip the code used. This ordering
    // means a code can never be consumed without a grant: if the grant insert
    // fails the code stays usable, and if the flip loses a race to another
    // redemption we roll the grant back so no access is granted twice.
    const { data: grant, error: grantErr } = await supabase
      .from("subscription_extensions")
      .insert({
        user_id: user.id,
        days: grantDays,
        reason: "redeemed recovery code",
        granted_by: null,
      })
      .select("*")
      .maybeSingle();
    if (grantErr) return bad(400, grantErr.message);

    const { data: used, error: useErr } = await supabase
      .from("subscription_recovery_codes")
      .update({ used: true, used_at: now })
      .eq("id", existing.id)
      .eq("used", false)
      .select("id")
      .maybeSingle();
    if (useErr) {
      await supabase
        .from("subscription_extensions")
        .delete()
        .eq("id", grant.id);
      return bad(400, useErr.message);
    }
    if (!used) {
      // Another redemption already consumed this code; undo our grant.
      await supabase
        .from("subscription_extensions")
        .delete()
        .eq("id", grant.id);
      return bad(409, "This recovery code was already used");
    }

    // Resume a billing-driven copier pause right away; a pause the user set
    // themselves stays as it is.
    await supabase
      .from("user_profiles")
      .update({
        copier_paused: false,
        copier_pause_reason: null,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .eq("copier_paused", true)
      .in("copier_pause_reason", RESTARTABLE_PAUSE_REASONS);

    return Response.json(
      { ok: true, days: grantDays, extension: grant },
      { headers: corsHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return bad(500, message);
  }
});
