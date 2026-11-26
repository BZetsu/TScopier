/** Permanently hide the in-app Trustpilot rating prompt (user clicked Rate). */
const DONE_KEY = 'tsc_trustpilot_prompt_done'
/** Snooze until this timestamp (Remind later / close). */
const SNOOZE_UNTIL_KEY = 'tsc_trustpilot_prompt_snooze_until'
/** Session id that last dismissed the prompt (localStorage so it survives logout). */
const DISMISSED_SESSION_KEY = 'tsc_trustpilot_prompt_dismissed_session'
/** Per-tab login session id (sessionStorage — new after logout / new browser session). */
const SESSION_ID_KEY = 'tsc_trustpilot_prompt_session_id'

export const TRUSTPILOT_EVALUATE_URL = 'https://www.trustpilot.com/evaluate/unicopier.com'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function browserSessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_ID_KEY)
    if (!id) {
      id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      window.sessionStorage.setItem(SESSION_ID_KEY, id)
    }
    return id
  } catch {
    return `fallback-${Date.now()}`
  }
}

export function isTrustpilotPromptDone(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function markTrustpilotPromptDone(): void {
  try {
    window.localStorage.setItem(DONE_KEY, '1')
    window.localStorage.removeItem(SNOOZE_UNTIL_KEY)
    window.localStorage.removeItem(DISMISSED_SESSION_KEY)
  } catch {
    /* noop */
  }
}

/** Remind later / close: hide for this session; re-show after 7 days or on next login (new session). */
export function snoozeTrustpilotPrompt(): void {
  try {
    window.localStorage.setItem(SNOOZE_UNTIL_KEY, String(Date.now() + SEVEN_DAYS_MS))
    window.localStorage.setItem(DISMISSED_SESSION_KEY, browserSessionId())
  } catch {
    /* noop */
  }
}

export function shouldShowTrustpilotPrompt(): boolean {
  if (typeof window === 'undefined') return false
  if (isTrustpilotPromptDone()) return false
  try {
    const snoozeUntil = Number(window.localStorage.getItem(SNOOZE_UNTIL_KEY) || 0)
    const dismissedSession = window.localStorage.getItem(DISMISSED_SESSION_KEY)
    const currentSession = browserSessionId()

    // Never dismissed → show
    if (!dismissedSession) return true
    // Next login / new browser session after dismiss → show
    if (dismissedSession !== currentSession) return true
    // Same session: only after the 7-day snooze
    if (snoozeUntil > 0 && Date.now() >= snoozeUntil) return true
    return false
  } catch {
    return true
  }
}
