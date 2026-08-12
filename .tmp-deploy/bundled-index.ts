import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";


import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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

/**
 * Server-side signup email policy — blocks obvious spam, adult brand domains,
 * keyword locals, and disposable providers.
 * Keep in sync with src/lib/signupEmailPolicy.ts and block_spam_auth_signup().
 */

/** pornhub / porhub / prhub + digits — bots rotate the local-part spelling. */
const PORNHUB_STYLE_LOCAL = /^p[o0]{0,1}r{1,2}n?hub\d+$/i

/** Letters + 5+ digits on Microsoft consumer mail (mamadou429302@hotmail.com). */
const MS_NAME_DIGITS_LOCAL = /^[a-z]{3,16}[0-9]{5,}$/i

const MS_CONSUMER_DOMAINS = new Set([
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "hotmail.fr",
  "outlook.fr",
  "live.fr",
  "hotmail.co.uk",
  "outlook.co.uk",
])

const DEFAULT_BLOCKED_LOCAL_PATTERNS: RegExp[] = [
  PORNHUB_STYLE_LOCAL,
  /^[0-9]{6,}$/,
  /^(.)\1{5,}$/,
]

const DEFAULT_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "grr.la",
  "tempmail.com",
  "temp-mail.org",
  "throwaway.email",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "10minutemail.com",
  "fakeinbox.com",
  "maildrop.cc",
  "mailnesia.com",
  "example.com",
  "example.net",
  "example.org",
])

const DEFAULT_BLOCKED_DOMAINS = new Set([
  "pornhub.com",
  "pornhub.net",
  "pornhub.org",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "onlyfans.com",
  "brazzers.com",
  "spankbang.com",
])

const DEFAULT_BLOCKED_KEYWORDS = [
  "pornhub",
  "porhub",
  "xvideos",
  "xnxx",
  "xhamster",
  "redtube",
  "youporn",
  "onlyfans",
  "brazzers",
  "spankbang",
  "gayporn",
  "sexhub",
  "porn",
  "xxx",
  "nsfw",
  "gay",
]

export type EmailSignupPolicyResult =
  | { allowed: true; normalizedEmail: string }
  | { allowed: false; reason: string; code: "invalid_email" | "blocked_email" | "disposable_domain" }

function parseExtraList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function parseExtraPatterns(raw: string | undefined): RegExp[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i")
      } catch {
        console.warn("[emailSignupPolicy] invalid SIGNUP_BLOCKED_EMAIL_PATTERNS entry:", pattern)
        return null
      }
    })
    .filter((re): re is RegExp => re !== null)
}

function blockedLocalPatterns(): RegExp[] {
  return [...DEFAULT_BLOCKED_LOCAL_PATTERNS, ...parseExtraPatterns(Deno.env.get("SIGNUP_BLOCKED_EMAIL_PATTERNS"))]
}

function blockedKeywords(): string[] {
  return [...DEFAULT_BLOCKED_KEYWORDS, ...parseExtraList(Deno.env.get("SIGNUP_BLOCKED_EMAIL_KEYWORDS"))]
}

function blockedDomains(): Set<string> {
  return new Set([...DEFAULT_BLOCKED_DOMAINS, ...parseExtraList(Deno.env.get("SIGNUP_BLOCKED_EMAIL_DOMAINS"))])
}

function containsBlockedKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => haystack.includes(kw))
}

export function normalizeSignupEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (!email.includes("@")) return null
  const [local, domain] = email.split("@")
  if (!local || !domain || domain.includes(" ")) return null
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null
  return email
}

export function evaluateSignupEmail(raw: unknown): EmailSignupPolicyResult {
  const normalizedEmail = normalizeSignupEmail(raw)
  if (!normalizedEmail) {
    return { allowed: false, reason: "Invalid email address", code: "invalid_email" }
  }

  const [localPart, domain] = normalizedEmail.split("@")
  if (DEFAULT_DISPOSABLE_DOMAINS.has(domain)) {
    return {
      allowed: false,
      reason: "Disposable email addresses are not allowed",
      code: "disposable_domain",
    }
  }

  if (blockedDomains().has(domain)) {
    return {
      allowed: false,
      reason: "This email address is not allowed",
      code: "blocked_email",
    }
  }

  const keywords = blockedKeywords()
  if (containsBlockedKeyword(localPart, keywords) || containsBlockedKeyword(domain, keywords)) {
    return {
      allowed: false,
      reason: "This email address is not allowed",
      code: "blocked_email",
    }
  }

  if (MS_CONSUMER_DOMAINS.has(domain) && MS_NAME_DIGITS_LOCAL.test(localPart)) {
    return {
      allowed: false,
      reason: "This email address is not allowed",
      code: "blocked_email",
    }
  }

  for (const pattern of blockedLocalPatterns()) {
    if (pattern.test(localPart)) {
      return {
        allowed: false,
        reason: "This email address is not allowed",
        code: "blocked_email",
      }
    }
  }

  return { allowed: true, normalizedEmail }
}

/** Returns true when email matches known spam signup patterns (for admin cleanup). */
export function isSuspiciousSignupEmail(email: string): boolean {
  const result = evaluateSignupEmail(email)
  return !result.allowed && result.code !== "invalid_email"
}

const COMPANY_FOOTER = `Tartarix Inc.<br>
131 Continental Dr<br>
Suite 305<br>
Newark, DE 19713 US`

export function buildAuthEmailHtml(args: {
  title: string
  greeting: string
  bodyHtml: string
  buttonLabel: string
  buttonUrl: string
  footerNote?: string
  logoUrl?: string | null
}): string {
  const footerNote = args.footerNote
    ? `<p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:#737373;">${args.footerNote}</p>`
    : ""

  const logoBlock = args.logoUrl
    ? `<img src="${args.logoUrl}" alt="TScopier" width="148" height="36" style="display:block;margin:0 0 20px 0;height:36px;width:auto;max-width:180px;border:0;" />`
    : `<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#0d9488;">TScopier</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${args.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:40px 40px 0 40px;">
              ${logoBlock}
              <h1 style="margin:0 0 24px 0;font-size:22px;font-weight:600;color:#171717;line-height:1.3;">
                ${args.title}
              </h1>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#404040;">
                ${args.greeting}
              </p>
              <div style="margin:0 0 32px 0;font-size:15px;line-height:1.6;color:#404040;">
                ${args.bodyHtml}
              </div>
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 40px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:8px;background-color:#0d9488;">
                    <a href="${args.buttonUrl}" target="_blank" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                      ${args.buttonLabel}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e5e5e5;margin:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 40px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#a3a3a3;">
                ${COMPANY_FOOTER}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Public Storage URLs for TScopier brand images in emails. */

export const EMAIL_ASSETS_BUCKET = "email-assets";

export type EmailLogoVariant = "light" | "dark" | "mark";

const LOGO_FILES: Record<EmailLogoVariant, string> = {
  light: "tscopierlogo.png",
  dark: "tscopierlogo-dark.png",
  mark: "tslogo-collapse.png",
};

export function emailAssetsPublicBase(supabaseUrl: string): string {
  return `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}`;
}

export function emailBrandLogoUrl(
  supabaseUrl: string,
  variant: EmailLogoVariant = "light",
): string {
  return `${emailAssetsPublicBase(supabaseUrl)}/${LOGO_FILES[variant]}`;
}

/** Prefer explicit override, then Storage, then app-hosted fallback. */
export function resolveEmailLogoUrl(args: {
  supabaseUrl: string;
  appUrl?: string | null;
  variant?: EmailLogoVariant;
  explicitUrl?: string | null;
}): string {
  const explicit = String(args.explicitUrl ?? "").trim();
  if (explicit) return explicit;

  const supabaseUrl = String(args.supabaseUrl ?? "").trim();
  if (supabaseUrl) {
    return emailBrandLogoUrl(supabaseUrl, args.variant ?? "light");
  }

  const appUrl = String(args.appUrl ?? "https://app.tscopier.ai").replace(/\/$/, "");
  const file = LOGO_FILES[args.variant ?? "light"];
  return `${appUrl}/${file}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** Minimum seconds between verification emails for the same address. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Max verification emails per address per rolling hour. */
const RESEND_MAX_PER_HOUR = 5;

function json(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = "TScopier <verification@tscopier.ai>";

    if (!resendApiKey) {
      return json(
        { error: "RESEND_API_KEY not configured on the server" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({})) as {
      confirmUrl?: string;
      redirectTo?: string;
      email?: string;
      captchaToken?: string;
    };

    const clientIp = extractClientIp(req);
    const globalLimitResponse = await enforceGlobalRateLimit(
      supabase,
      "verification_email",
      AUTH_EMAIL_MAX_PER_HOUR_GLOBAL,
      corsHeaders,
    );
    if (globalLimitResponse) return globalLimitResponse;

    const ipLimitResponse = await enforceIpRateLimit(
      req,
      supabase,
      "verification_email",
      AUTH_EMAIL_MAX_PER_HOUR_IP,
      corsHeaders,
    );
    if (ipLimitResponse) return ipLimitResponse;

    const redirectTo =
      body.redirectTo ||
      body.confirmUrl ||
      `${req.headers.get("origin") ?? "http://localhost:5173"}/dashboard`;

    let targetEmail: string | undefined;
    let firstName = "there";
    let hasAuthedUser = false;

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(
        token,
      );
      if (!authError && user?.email) {
        hasAuthedUser = true;
        targetEmail = user.email;
        firstName = (user.user_metadata?.first_name as string) || firstName;
      }
    }

    if (!targetEmail && typeof body.email === "string") {
      const normalized = body.email.trim().toLowerCase();
      if (normalized.includes("@")) {
        targetEmail = normalized;
      }
    }

    if (!targetEmail) {
      return json({ error: "Missing email" }, 400);
    }

    if (!hasAuthedUser) {
      const captchaOk = await verifyTurnstileToken(body.captchaToken, clientIp);
      if (!captchaOk) {
        return json({ error: "Captcha verification failed", code: "captcha_failed" }, 403);
      }
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    const emailPolicy = evaluateSignupEmail(normalizedEmail);
    if (!emailPolicy.allowed) {
      return json(
        { error: emailPolicy.reason, code: emailPolicy.code },
        400,
      );
    }

    const { data: claimData, error: claimError } = await supabase.rpc(
      "claim_verification_email_send",
      {
        p_email: normalizedEmail,
        p_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
        p_max_per_hour: RESEND_MAX_PER_HOUR,
      },
    );

    if (claimError) {
      console.error("[send-verification-email] claim error:", claimError);
      return json(
        { error: "Could not rate-limit verification email", details: claimError.message },
        500,
      );
    }

    const claim = (claimData ?? {}) as {
      ok?: boolean;
      error?: string;
      retry_after_seconds?: number;
      cooldown_seconds?: number;
    };

    if (!claim.ok) {
      const retryAfter = Math.max(1, Number(claim.retry_after_seconds ?? RESEND_COOLDOWN_SECONDS));
      const code = claim.error === "rate_limited" ? "rate_limited" : "cooldown";
      return json(
        {
          error: code,
          code,
          retry_after_seconds: retryAfter,
          message:
            code === "rate_limited"
              ? "Too many verification emails. Try again later."
              : "Please wait before requesting another verification email.",
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    if (firstName === "there") {
      const { data: listed } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 50,
      });
      const match = listed?.users?.find(
        (u) => u.email?.toLowerCase() === normalizedEmail,
      );
      if (match?.user_metadata?.first_name) {
        firstName = String(match.user_metadata.first_name);
      }
    }

    // Prefer a signup confirmation link. Fall back to magiclink when the user
    // is already auth-confirmed (e.g. Confirm email disabled / auto-confirm).
    let confirmUrl: string | undefined;
    let linkErrorMessage: string | undefined;

    const signupLink = await supabase.auth.admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      options: { redirectTo },
    });
    if (signupLink.data?.properties?.action_link) {
      confirmUrl = signupLink.data.properties.action_link;
    } else {
      linkErrorMessage = signupLink.error?.message;
      const magicLink = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
        options: { redirectTo },
      });
      if (magicLink.data?.properties?.action_link) {
        confirmUrl = magicLink.data.properties.action_link;
      } else {
        linkErrorMessage =
          magicLink.error?.message ?? linkErrorMessage ?? "no action_link returned";
      }
    }

    if (!confirmUrl) {
      return json(
        {
          error: "Could not create verification link",
          details: linkErrorMessage ?? "no action_link returned",
        },
        500,
      );
    }
    const logoUrl = resolveEmailLogoUrl({
      supabaseUrl,
      appUrl: Deno.env.get("VITE_APP_URL"),
      variant: "light",
      explicitUrl: Deno.env.get("EMAIL_LOGO_URL"),
    });

    const html = buildAuthEmailHtml({
      title: "Confirm your account",
      greeting: `Hello ${firstName},`,
      bodyHtml: `<p style="margin:0;">Thank you for signing up for TScopier. Click the button below to confirm your email and activate your account.</p>`,
      buttonLabel: "Confirm account",
      buttonUrl: confirmUrl,
      logoUrl,
    });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [normalizedEmail],
        subject: "Confirm your TScopier account",
        html,
      }),
    });

    if (!resendRes.ok) {
      const resendError = await resendRes.text();
      console.error("[send-verification-email] Resend error:", resendError);
      return json(
        {
          error: "Failed to send email via Resend",
          details: resendError,
          hint:
            "Verify RESEND_API_KEY and that tscopier.ai is verified in Resend for verification@tscopier.ai.",
        },
        502,
      );
    }

    const resendData = await resendRes.json();

    return json({
      success: true,
      id: resendData.id,
      cooldown_seconds: claim.cooldown_seconds ?? RESEND_COOLDOWN_SECONDS,
    }, 200);
  } catch (err) {
    console.error("[send-verification-email]", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
