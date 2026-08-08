/** Shared Telegram phone/OTP normalizers for Copier Engine and in-chat assistant linking. */

export function normalizeTelegramPhoneInput(raw: string): string {
  const compact = String(raw ?? '').trim().replace(/[\s\-()]/g, '')
  if (compact.startsWith('00')) return `+${compact.slice(2)}`
  return compact
}

export function normalizeTelegramCodeInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '')
}

/** E.164-ish phone for Telegram send_code. */
export function isPlausibleTelegramPhone(raw: string): boolean {
  const phone = normalizeTelegramPhoneInput(raw)
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

/** Extract a plausible phone from free-text chat (e.g. "+2349054538604"). */
export function extractTelegramPhoneFromText(text: string): string | null {
  const compact = String(text ?? '').trim()
  if (isPlausibleTelegramPhone(compact)) return normalizeTelegramPhoneInput(compact)
  const match = compact.match(/(?:\+|00)\d[\d\s\-()]{6,18}\d/)
  if (!match) return null
  const phone = normalizeTelegramPhoneInput(match[0])
  return isPlausibleTelegramPhone(phone) ? phone : null
}

/** Short digit-only strings that look like an OTP (never send to the LLM). */
export function looksLikeTelegramOtp(text: string): boolean {
  const code = normalizeTelegramCodeInput(text)
  const trimmed = String(text ?? '').trim()
  if (!code || code.length < 4 || code.length > 8) return false
  // Entire message is essentially just the code (allow spaces/dashes)
  return /^[\d\s\-]+$/.test(trimmed) && normalizeTelegramCodeInput(trimmed) === code
}

const PHONE_REDACT = /(?:\+|00)\d[\d\s\-()]{6,18}\d/g

/** Redact phone-looking substrings from history / outbound LLM text. */
export function redactTelegramPhones(text: string): string {
  return String(text ?? '').replace(PHONE_REDACT, '[phone]')
}
