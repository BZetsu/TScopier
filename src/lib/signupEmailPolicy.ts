/**
 * Client-side signup email policy — keep in sync with
 * supabase/functions/_shared/emailSignupPolicy.ts
 * and public.block_spam_auth_signup() trigger.
 */

const PORNHUB_STYLE_LOCAL = /^p[o0]{0,1}r{1,2}n?hub\d+$/i

/** Letters + 5+ digits on Microsoft consumer mail (mamadou429302@hotmail.com). */
const MS_NAME_DIGITS_LOCAL = /^[a-z]{3,16}[0-9]{5,}$/i

const MS_CONSUMER_DOMAINS = new Set([
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'hotmail.fr',
  'outlook.fr',
  'live.fr',
  'hotmail.co.uk',
  'outlook.co.uk',
])

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
  // RFC 2606 reserved — bots use these as fake inboxes
  'example.com',
  'example.net',
  'example.org',
])

/** Exact adult / spam brand domains (e.g. gaylord297426@pornhub.com). */
const DEFAULT_BLOCKED_DOMAINS = new Set([
  'pornhub.com',
  'pornhub.net',
  'pornhub.org',
  'xvideos.com',
  'xnxx.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'onlyfans.com',
  'brazzers.com',
  'spankbang.com',
  // Temporary: high-volume spam providers (bots rotating outlook/hotmail/proton)
  'hotmail.com',
  'outlook.com',
  'outlook.co.uk',
  'proton.me',
])

/**
 * Substrings blocked in local-part OR domain.
 * Includes short tokens like "gay" / "porn" to stop current spam waves;
 * may false-positive rare real names (Gaylord, Gayle).
 */
const DEFAULT_BLOCKED_KEYWORDS = [
  'pornhub',
  'porhub',
  'xvideos',
  'xnxx',
  'xhamster',
  'redtube',
  'youporn',
  'onlyfans',
  'brazzers',
  'spankbang',
  'gayporn',
  'sexhub',
  'porn',
  'xxx',
  'nsfw',
  'gay',
]

export type SignupEmailPolicyCode = 'invalid_email' | 'blocked_email' | 'disposable_domain'

export type SignupEmailPolicyResult =
  | { allowed: true; normalizedEmail: string }
  | { allowed: false; code: SignupEmailPolicyCode }

function containsBlockedKeyword(haystack: string): boolean {
  return DEFAULT_BLOCKED_KEYWORDS.some((kw) => haystack.includes(kw))
}

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

  if (DEFAULT_BLOCKED_DOMAINS.has(domain)) {
    return { allowed: false, code: 'blocked_email' }
  }

  if (containsBlockedKeyword(localPart) || containsBlockedKeyword(domain)) {
    return { allowed: false, code: 'blocked_email' }
  }

  if (MS_CONSUMER_DOMAINS.has(domain) && MS_NAME_DIGITS_LOCAL.test(localPart)) {
    return { allowed: false, code: 'blocked_email' }
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
    lower.includes('this email is not allowed')
    || lower.includes('this email address is not allowed')
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
