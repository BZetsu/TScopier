/**
 * Client-side signup email policy — keep in sync with
 * supabase/functions/_shared/emailSignupPolicy.ts
 */

const PORNHUB_STYLE_LOCAL = /^p[o0]{0,1}r{1,2}n?hub\d+$/i

const DEFAULT_BLOCKED_LOCAL_PATTERNS: RegExp[] = [
  PORNHUB_STYLE_LOCAL,
  /^[0-9]{6,}$/,
  /^(.)\1{5,}$/,
]

const DEFAULT_DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  'grr.la',
  'tempmail.com',
  'temp-mail.org',
  'throwaway.email',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  '10minutemail.com',
  'fakeinbox.com',
  'maildrop.cc',
  'mailnesia.com',
])

export type SignupEmailPolicyCode = 'invalid_email' | 'blocked_email' | 'disposable_domain'

export type SignupEmailPolicyResult =
  | { allowed: true; normalizedEmail: string }
  | { allowed: false; code: SignupEmailPolicyCode }

export function evaluateSignupEmail(raw: string): SignupEmailPolicyResult {
  const email = raw.trim().toLowerCase()
  if (!email.includes('@')) {
    return { allowed: false, code: 'invalid_email' }
  }

  const [localPart, domain] = email.split('@')
  if (!localPart || !domain || domain.includes(' ')) {
    return { allowed: false, code: 'invalid_email' }
  }

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
    return { allowed: false, code: 'invalid_email' }
  }

  if (DEFAULT_DISPOSABLE_DOMAINS.has(domain)) {
    return { allowed: false, code: 'disposable_domain' }
  }

  for (const pattern of DEFAULT_BLOCKED_LOCAL_PATTERNS) {
    if (pattern.test(localPart)) {
      return { allowed: false, code: 'blocked_email' }
    }
  }

  return { allowed: true, normalizedEmail: email }
}

/** Maps Supabase Auth / DB trigger errors to signup policy codes when possible. */
export function signupErrorPolicyCode(message: string): SignupEmailPolicyCode | null {
  const lower = message.toLowerCase()
  if (lower.includes('disposable email')) return 'disposable_domain'
  if (
    lower.includes('this email address is not allowed')
    || lower.includes('database error saving new user')
  ) {
    return 'blocked_email'
  }
  return null
}

export function signupPolicyMessage(
  code: SignupEmailPolicyCode,
  labels: {
    emailNotAllowed: string
    disposableEmailNotAllowed: string
  },
): string {
  if (code === 'disposable_domain') return labels.disposableEmailNotAllowed
  if (code === 'blocked_email') return labels.emailNotAllowed
  return labels.emailNotAllowed
}
