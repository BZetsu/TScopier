import type { SupabaseClient } from '@supabase/supabase-js'
import type { CopierLogsTranslations } from '../i18n/locales/types'
import type { Signal } from '../types/database'
import {
  COPIER_SKIP_REASON_DETAILS,
  COPIER_SKIP_REASON_LABELS,
  resolveCopierSkipReasonKey,
} from './copierSkipReasonLabels'

export type CopierExecutionLogRow = {
  action: string
  status: string
  error_message: string | null
  request_payload: Record<string, unknown> | null
  created_at: string
}

export function formatCopierSkipReasonShort(
  reason: string | null | undefined,
  copierLogs: CopierLogsTranslations,
): string {
  const raw = String(reason ?? '').trim()
  if (!raw) return '—'
  const key = resolveCopierSkipReasonKey(raw)
  return (
    copierLogs.skipReasons[key]
    ?? COPIER_SKIP_REASON_LABELS[key]
    ?? raw.replace(/_/g, ' ')
  )
}

export function formatCopierSkipReasonDetail(
  reason: string | null | undefined,
  copierLogs: CopierLogsTranslations,
): string | null {
  const raw = String(reason ?? '').trim()
  if (!raw) return null
  const key = resolveCopierSkipReasonKey(raw)
  return (
    copierLogs.skipReasonDetails?.[key]
    ?? COPIER_SKIP_REASON_DETAILS[key]
    ?? null
  )
}

export function formatParsedLevels(signal: Signal): {
  entry: string | null
  sl: string | null
  tp: string | null
} {
  const parsed = signal.parsed_data as Record<string, unknown> | null
  if (!parsed) return { entry: null, sl: null, tp: null }

  const fmt = (v: unknown): string | null => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n > 0 ? String(n) : null
  }

  const entry =
    fmt(parsed.entry_price)
    ?? fmt(parsed.entry)
    ?? (parsed.entry_zone_low != null && parsed.entry_zone_high != null
      ? `${parsed.entry_zone_low}–${parsed.entry_zone_high}`
      : null)

  const tpList = Array.isArray(parsed.tp)
    ? parsed.tp
        .map(fmt)
        .filter((v): v is string => v != null)
    : []

  return {
    entry,
    sl: fmt(parsed.sl),
    tp: tpList.length ? tpList.join(', ') : null,
  }
}

export async function fetchCopierLogExecutionDetails(
  supabase: SupabaseClient,
  signalId: string,
): Promise<CopierExecutionLogRow[]> {
  const { data, error } = await supabase
    .from('trade_execution_logs')
    .select('action, status, error_message, request_payload, created_at')
    .eq('signal_id', signalId)
    .order('created_at', { ascending: true })
    .limit(20)

  if (error || !data?.length) return []

  return data as CopierExecutionLogRow[]
}

export function summarizeExecutionLogRow(
  row: CopierExecutionLogRow,
  copierLogs: CopierLogsTranslations,
): string {
  const payload = row.request_payload ?? {}
  const skipReason = String(payload.skip_reason ?? row.error_message ?? '').trim()
  if (row.action === 'dispatch_skipped' && skipReason) {
    return formatCopierSkipReasonShort(skipReason, copierLogs)
  }
  if (row.action === 'order_send' && row.status === 'failed') {
    const err = String(row.error_message ?? 'Order failed').trim()
    return formatCopierSkipReasonShort(err, copierLogs)
  }
  if (row.action === 'pipeline_summary') {
    const failure = String(payload.failure_reason ?? '').trim()
    if (failure) return formatCopierSkipReasonShort(failure, copierLogs)
  }
  const actionLabel = row.action.replace(/_/g, ' ')
  if (row.error_message) {
    return `${actionLabel}: ${formatCopierSkipReasonShort(row.error_message, copierLogs)}`
  }
  return `${actionLabel} (${row.status})`
}
