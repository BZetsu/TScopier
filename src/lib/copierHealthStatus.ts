import type { SupabaseClient } from '@supabase/supabase-js'

export type TelegramAccountStatus = 'not_linked' | 'linked' | 'invalid' | 'reconnect_required' | 'unknown'
export type SignalListenerStatus = 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'unknown'
export type CopierEngineStatus = 'operational' | 'degraded' | 'offline' | 'stopped' | 'unknown'
export type WorkerOwnershipStatus = 'owned' | 'lease_expiring' | 'unowned' | 'stale' | 'unknown'

export type CopierHealthSnapshot = {
  telegramAccountStatus: TelegramAccountStatus
  signalListenerStatus: SignalListenerStatus
  copierEngineStatus: CopierEngineStatus
  workerOwnershipStatus: WorkerOwnershipStatus
  lastSuccessfulHealthAt: string | null
  updatedAt: string | null
  reason: string | null
}

const TELEGRAM_ACCOUNT = new Set(['not_linked', 'linked', 'invalid', 'reconnect_required'])
const LISTENER = new Set(['connected', 'reconnecting', 'disconnected', 'failed', 'unknown'])
const ENGINE = new Set(['operational', 'degraded', 'offline', 'stopped'])
const OWNERSHIP = new Set(['owned', 'lease_expiring', 'unowned', 'stale'])
const DEFAULT_FRESHNESS_THRESHOLD_MS = 90_000
const MAX_CLOCK_SKEW_MS = 5 * 60_000

function oneOf<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? value as T : fallback
}

function parseTimestamp(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string') return null
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return null
  if (ms > nowMs + MAX_CLOCK_SKEW_MS) return null
  return ms
}

function freshnessThresholdMs(row: Record<string, unknown>): number {
  const n = Number(row.freshness_threshold_ms)
  return Number.isFinite(n) && n > 0 ? Math.max(1_000, Math.min(10 * 60_000, Math.floor(n))) : DEFAULT_FRESHNESS_THRESHOLD_MS
}

export function copierHealthFromRow(
  row: Record<string, unknown> | null | undefined,
  opts?: { nowMs?: number },
): CopierHealthSnapshot {
  if (!row) {
    return {
      telegramAccountStatus: 'unknown',
      signalListenerStatus: 'unknown',
      copierEngineStatus: 'unknown',
      workerOwnershipStatus: 'unknown',
      lastSuccessfulHealthAt: null,
      updatedAt: null,
      reason: null,
    }
  }
  const nowMs = opts?.nowMs ?? Date.now()
  const telegramAccountStatus = oneOf<TelegramAccountStatus>(row.telegram_account_status, TELEGRAM_ACCOUNT, 'unknown')
  const signalListenerStatus = oneOf<SignalListenerStatus>(row.listener_status, LISTENER, 'unknown')
  const workerOwnershipStatus = oneOf<WorkerOwnershipStatus>(row.worker_ownership_status, OWNERSHIP, 'unknown')
  let copierEngineStatus = oneOf<CopierEngineStatus>(row.copier_engine_status, ENGINE, 'unknown')
  const updatedMs = parseTimestamp(row.updated_at, nowMs)
  const probeMs = parseTimestamp(row.last_successful_probe_at, nowMs)
  const threshold = freshnessThresholdMs(row)
  const rowFresh = updatedMs != null && nowMs - updatedMs <= threshold
  const probeFresh = probeMs != null && nowMs - probeMs <= threshold
  const canBeOperational =
    signalListenerStatus === 'connected'
    && row.mtproto_connected === true
    && workerOwnershipStatus === 'owned'
    && rowFresh
    && probeFresh
    && row.shutdown_in_progress !== true
    && row.recovery_exhausted !== true

  if (copierEngineStatus === 'operational' && !canBeOperational) {
    if (telegramAccountStatus === 'reconnect_required' || telegramAccountStatus === 'invalid') {
      copierEngineStatus = 'stopped'
    } else if (updatedMs == null || probeMs == null) {
      copierEngineStatus = 'unknown'
    } else {
      copierEngineStatus = 'offline'
    }
  }

  return {
    telegramAccountStatus,
    signalListenerStatus,
    copierEngineStatus,
    workerOwnershipStatus,
    lastSuccessfulHealthAt: typeof row.last_successful_probe_at === 'string' && probeMs != null ? row.last_successful_probe_at : null,
    updatedAt: typeof row.updated_at === 'string' && updatedMs != null ? row.updated_at : null,
    reason: typeof row.health_reason === 'string' ? row.health_reason : null,
  }
}

export async function fetchCopierHealthStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<CopierHealthSnapshot> {
  const { data, error } = await supabase
    .from('copier_listener_health')
    .select('telegram_account_status,listener_status,copier_engine_status,worker_ownership_status,mtproto_connected,last_successful_probe_at,updated_at,health_reason,recovery_exhausted,shutdown_in_progress,freshness_threshold_ms')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.warn('[copierHealthStatus] fetch failed:', error.message)
    return copierHealthFromRow(null)
  }
  return copierHealthFromRow(data as Record<string, unknown> | null)
}
