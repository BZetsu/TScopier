import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  affiliateCorsHeaders,
  codeLooksValid,
  normalizeReferralCode,
  requireAuthedUser,
} from "../_shared/affiliate.ts";

const ALLOWED_SOURCES = new Set(["signup_url", "signup_form", "onboarding", "admin"]);

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, {
    status,
    headers: affiliateCorsHeaders,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: affiliateCorsHeaders });
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
    const code = normalizeReferralCode(String(body.referral_code ?? ""));
    const sourceRaw = String(body.source ?? "onboarding");
    const source = ALLOWED_SOURCES.has(sourceRaw) ? sourceRaw : "onboarding";

    if (!codeLooksValid(code)) {
      return bad(400, "Invalid referral code format");
    }

    const existing = await supabase
      .from("referral_attributions")
      .select("id,affiliate_user_id,referral_code")
      .eq("referred_user_id", user.id)
      .maybeSingle();
    if (existing.error) return bad(400, existing.error.message);
    if (existing.data) {
      return Response.json({
        ok: true,
        already_applied: true,
        attribution: existing.data,
      }, { headers: affiliateCorsHeaders });
    }

    const owner = await supabase
      .from("affiliate_profiles")
      .select("user_id,referral_code,is_active")
      .ilike("referral_code", code)
      .maybeSingle();
    if (owner.error) return bad(400, owner.error.message);
    if (!owner.data || owner.data.is_active !== true) {
      return bad(404, "Referral code not found");
    }
    if (owner.data.user_id === user.id) {
      return bad(400, "You cannot apply your own referral code");
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("referral_attributions")
      .insert({
        referred_user_id: user.id,
        affiliate_user_id: owner.data.user_id,
        referral_code: owner.data.referral_code,
        attribution_source: source,
      })
      .select("*")
      .single();
    if (insertErr) return bad(400, insertErr.message);

    await supabase
      .from("user_profiles")
      .update({
        referred_by_user_id: owner.data.user_id,
      })
      .eq("user_id", user.id);

    return Response.json({
      ok: true,
      attribution: inserted,
    }, { headers: affiliateCorsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return bad(500, message);
  }
});

