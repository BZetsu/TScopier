import { getCookie, setCookie } from './cookies'

const CONSENT_KEY = 'tsc_tracking_consent'
const CONSENT_TS_KEY = 'tsc_tracking_seen_ts'
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

export type TrackingConsentStatus = 'accepted' | 'dismissed' | null

export function getTrackingConsentStatus(): TrackingConsentStatus {
  const v = getCookie(CONSENT_KEY)
  if (v === 'accepted' || v === 'dismissed') return v
  return null
}

export function getTrackingConsentSeenTs(): number | null {
  const raw = getCookie(CONSENT_TS_KEY)
  const n = Number(raw ?? '')
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function markTrackingConsentAccepted(): void {
  const now = String(Date.now())
  setCookie(CONSENT_KEY, 'accepted', { maxAgeSeconds: ONE_YEAR_SECONDS })
  setCookie(CONSENT_TS_KEY, now, { maxAgeSeconds: ONE_YEAR_SECONDS })
}

export function markTrackingConsentDismissed(): void {
  const now = String(Date.now())
  setCookie(CONSENT_KEY, 'dismissed', { maxAgeSeconds: ONE_YEAR_SECONDS })
  setCookie(CONSENT_TS_KEY, now, { maxAgeSeconds: ONE_YEAR_SECONDS })
}

export function shouldShowTrackingBanner(): boolean {
  return getTrackingConsentStatus() == null
}

