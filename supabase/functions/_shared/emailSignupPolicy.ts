/**
 * Server-side signup email policy — blocks obvious spam and disposable providers.
 */

/** pornhub / porhub / prhub + digits — bots rotate the local-part spelling. */
const PORNHUB_STYLE_LOCAL = /^p[o0]{0,1}r{1,2}n?hub\d+$/i

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
])

export type EmailSignupPolicyResult =
  | { allowed: true; normalizedEmail: string }
  | { allowed: false; reason: string; code: "invalid_email" | "blocked_email" | "disposable_domain" }

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
