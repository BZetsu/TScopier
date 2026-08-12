import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Max auth-email sends per IP per rolling hour (verification + password reset). */
export const AUTH_EMAIL_MAX_PER_HOUR_IP = 3

/** Absolute cap on verification emails across all IPs (stops IP-rotation floods). */
export const AUTH_EMAIL_MAX_PER_HOUR_GLOBAL = 20

/** Shared bucket when client IP headers are missing (do not skip rate limiting). */
export const MISSING_IP_HASH = "missing-ip";

export function extractClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp

  const forwarded = req.headers.get("x-forwarded-for")?.trim()
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }

  const realIp = req.headers.get("x-real-ip")?.trim()
  return realIp || null
}

export async function hashClientIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export type AbuseClaimResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

export async function claimAuthAbuseSlot(
  supabase: SupabaseClient,
  action: string,
  ip: string,
  maxPerHour = AUTH_EMAIL_MAX_PER_HOUR_IP,
): Promise<AbuseClaimResult> {
  const ipHash = await hashClientIp(ip)
  const { data, error } = await supabase.rpc("claim_auth_abuse_slot", {
    p_action: action,
    p_ip_hash: ipHash,
    p_max_per_hour: maxPerHour,
  })

  if (error) {
    console.error("[signupAbuseGuard] claim error:", error)
    throw new Error(error.message)
  }

  const claim = (data ?? {}) as {
    ok?: boolean
    retry_after_seconds?: number
  }

  if (claim.ok) return { ok: true }

  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Number(claim.retry_after_seconds ?? 3600)),
  }
}

export async function enforceIpRateLimit(
  req: Request,
  supabase: SupabaseClient,
  action: string,
  maxPerHour = AUTH_EMAIL_MAX_PER_HOUR_IP,
  corsHeaders?: Record<string, string>,
): Promise<Response | null> {
  const ip = extractClientIp(req)
  // Missing IP must still be capped — previously we skipped and bots bypassed limits.
  const claim = await claimAuthAbuseSlot(
    supabase,
    action,
    ip ?? MISSING_IP_HASH,
    maxPerHour,
  )
  if (claim.ok) return null

  return new Response(
    JSON.stringify({
      error: "rate_limited",
      code: "rate_limited",
      message: "Too many requests. Try again later.",
      retry_after_seconds: claim.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(claim.retryAfterSeconds),
        ...(corsHeaders ?? {}),
      },
    },
  )
}

/** Global (cross-IP) hourly cap for an auth-email action. */
export async function enforceGlobalRateLimit(
  supabase: SupabaseClient,
  action: string,
  maxPerHour = AUTH_EMAIL_MAX_PER_HOUR_GLOBAL,
  corsHeaders?: Record<string, string>,
): Promise<Response | null> {
  // Use literal sentinel ip_hash (not SHA-256) so this matches
  // claim_verification_email_send → claim_auth_abuse_slot(..., 'global', ...).
  const { data, error } = await supabase.rpc("claim_auth_abuse_slot", {
    p_action: `${action}_global`,
    p_ip_hash: "global",
    p_max_per_hour: maxPerHour,
  })

  if (error) {
    console.error("[signupAbuseGuard] global claim error:", error)
    throw new Error(error.message)
  }

  const claim = (data ?? {}) as { ok?: boolean; retry_after_seconds?: number }
  if (claim.ok) return null

  const retryAfterSeconds = Math.max(1, Number(claim.retry_after_seconds ?? 3600))
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      code: "rate_limited",
      message: "Too many requests. Try again later.",
      retry_after_seconds: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
        ...(corsHeaders ?? {}),
      },
    },
  )
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim()
  if (!secret) return true

  if (!token?.trim()) return false

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  })
  if (remoteIp) body.set("remoteip", remoteIp)

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })

  if (!res.ok) return false
  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}
