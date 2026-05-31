const REF_KEY = 'tsc_ref'
const REF_TS_KEY = 'tsc_ref_ts'
const REF_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const REFERRAL_CODE_MIN_LENGTH = 3
export const REFERRAL_CODE_MAX_LENGTH = 32

function nowMs(): number {
  return Date.now()
}

export function normalizeReferralCode(code: string): string {
  return code.trim()
}

export function referralCodeLooksValid(code: string): boolean {
  return new RegExp(`^\\S{${REFERRAL_CODE_MIN_LENGTH},${REFERRAL_CODE_MAX_LENGTH}}$`, 'u').test(code)
}

export function captureReferralFromUrl(search: string): string | null {
  const params = new URLSearchParams(search)
  const raw = params.get('ref') ?? ''
  const normalized = normalizeReferralCode(raw)
  if (!referralCodeLooksValid(normalized)) return null
  try {
    localStorage.setItem(REF_KEY, normalized)
    localStorage.setItem(REF_TS_KEY, String(nowMs()))
  } catch {
    // ignore storage issues
  }
  return normalized
}

export function loadStoredReferralCode(): string | null {
  try {
    const code = normalizeReferralCode(localStorage.getItem(REF_KEY) ?? '')
    const ts = Number(localStorage.getItem(REF_TS_KEY) ?? 0)
    if (!referralCodeLooksValid(code) || !Number.isFinite(ts) || ts <= 0) return null
    if (nowMs() - ts > REF_TTL_MS) {
      clearStoredReferralCode()
      return null
    }
    return code
  } catch {
    return null
  }
}

export function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(REF_KEY)
    localStorage.removeItem(REF_TS_KEY)
  } catch {
    // ignore
  }
}

