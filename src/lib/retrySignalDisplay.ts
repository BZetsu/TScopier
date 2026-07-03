import { interpolate } from '../i18n/interpolate'
import type { CopierLogsTranslations } from '../i18n/locales/types'
import type { Signal } from '../types/database'

const RETRYABLE_SKIP_REASONS = new Set([
  'entry_not_opened',
  'entry_zone_far_from_market',
  'broker_session_not_connected',
])

const RETRY_REASON_LABELS: Partial<Record<string, keyof CopierLogsTranslations>> = {
  signal_not_found: 'retryReasonNotRetryable',
  signal_not_retryable: 'retryReasonNotRetryable',
  dispatch_not_accepted: 'retryReasonDispatchRejected',
}

export function formatCopierSkipReason(
  reason: string | null | undefined,
  copierLogs: CopierLogsTranslations,
): string {
  const raw = String(reason ?? '').trim()
  if (!raw) return '—'
  const key = raw.toLowerCase()
  return copierLogs.skipReasons[key] ?? raw.replace(/_/g, ' ')
}

export function isCopierSignalRetryEligible(signal: Signal): boolean {
  const parsed = signal.parsed_data as { action?: string } | null
  const action = String(parsed?.action ?? '').toLowerCase()
  if (action !== 'buy' && action !== 'sell') return false
  if (signal.status === 'failed') return true
  if (signal.status === 'skipped') {
    const reason = String(signal.skip_reason ?? '').trim().toLowerCase()
    return RETRYABLE_SKIP_REASONS.has(reason)
  }
  return false
}

export function formatRetrySignalFailureReason(
  reason: string | undefined,
  copierLogs: CopierLogsTranslations,
): string {
  if (!reason?.trim()) return copierLogs.retryFailedGeneric
  const key = RETRY_REASON_LABELS[reason.trim()]
  if (key && copierLogs[key]) return String(copierLogs[key])
  return interpolate(copierLogs.retryFailedDetail, { reason: reason.trim() })
}
