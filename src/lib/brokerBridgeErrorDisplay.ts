/** User-facing copy for FxSocket bridge / trade-EA failures (HTTP 503, EA not ready). */

export const BROKER_BRIDGE_UNAVAILABLE_SKIP_KEY = 'broker_bridge_unavailable'

const HTTP_503_RE = /^http\s*503$/i

/** Normalize raw skip_reason / failure_reason from worker into a stable i18n lookup key. */
export function normalizeCopierSkipReasonKey(reason: string | null | undefined): string {
  const raw = String(reason ?? '').trim()
  if (!raw) return ''
  if (HTTP_503_RE.test(raw)) return BROKER_BRIDGE_UNAVAILABLE_SKIP_KEY
  return raw.toLowerCase()
}

export function isBrokerBridgeUnavailableMessage(message: string | null | undefined): boolean {
  const m = String(message ?? '').trim()
  if (!m) return false
  if (HTTP_503_RE.test(m)) return true
  if (/trade\s*ea\s*not\s*ready/i.test(m)) return true
  if (/bridge.*not\s*ready/i.test(m)) return true
  if (/service\s*unavailable/i.test(m) && /503/.test(m)) return true
  return false
}

export type BrokerBridgeErrorLabels = {
  bridgeUnavailable: string
  tradeEaNotReady: string
}

/** Map broker/bridge error snippets to actionable user text. */
export function formatBrokerBridgeErrorMessage(
  message: string | null | undefined,
  labels: BrokerBridgeErrorLabels,
): string | null {
  const m = String(message ?? '').trim()
  if (!m) return null
  if (HTTP_503_RE.test(m)) return labels.bridgeUnavailable
  if (/trade\s*ea\s*not\s*ready/i.test(m) || /bridge.*not\s*ready/i.test(m)) {
    return labels.tradeEaNotReady
  }
  return null
}

export function isTradeEaNotReadyStatus(status: {
  bridge?: { tradeEaReady?: boolean }
  status?: string
} | null | undefined): boolean {
  if (!status) return false
  if (status.bridge?.tradeEaReady === false) return true
  const s = String(status.status ?? '').trim().toLowerCase()
  return s === 'starting' || s === 'connecting'
}
