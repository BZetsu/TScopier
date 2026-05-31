import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

export const affiliateCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

export const DEFAULT_AFFILIATE_COMMISSION_RATE = 0.10;
export const REFERRAL_CODE_MIN_LENGTH = 3;
export const REFERRAL_CODE_MAX_LENGTH = 32;

export function normalizeReferralCode(input: string): string {
  return input.trim();
}

export function codeLooksValid(code: string): boolean {
  return new RegExp(`^\\S{${REFERRAL_CODE_MIN_LENGTH},${REFERRAL_CODE_MAX_LENGTH}}$`, "u").test(code);
}

export async function requireAuthedUser(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ user: User } | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      error: Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: affiliateCorsHeaders },
      ),
    };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      error: Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: affiliateCorsHeaders },
      ),
    };
  }
  return { user: data.user };
}

function randomSuffix(len = 4): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function baseFromUser(user: User): string {
  const display = String(user.user_metadata?.display_name ?? "").trim();
  const first = String(user.user_metadata?.first_name ?? "").trim();
  const last = String(user.user_metadata?.last_name ?? "").trim();
  const emailLocal = String(user.email ?? "").split("@")[0] ?? "";
  const seed = display || [first, last].filter(Boolean).join("") || emailLocal || user.id.slice(0, 6);
  const cleaned = seed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned || "TSCUSER";
}

export async function createUniqueReferralCode(
  supabase: SupabaseClient,
  user: User,
): Promise<string> {
  const base = baseFromUser(user);
  for (let i = 0; i < 24; i += 1) {
    const next = `${base}${randomSuffix(4)}`;
    const { data } = await supabase
      .from("affiliate_profiles")
      .select("user_id")
      .ilike("referral_code", next)
      .maybeSingle();
    if (!data) return next;
  }
  // Highly unlikely fallback.
  return `${base}${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

