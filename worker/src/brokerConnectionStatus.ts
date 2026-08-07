import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyBrokerConnectError,
  type BrokerConnectErrorKind,
} from './brokerConnectError'

type ConnectionStatus = 'pending' | 'connected' | 'recovering' | 'error'

const MIN_WRITE_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.BROKER_CONNECTION_STATUS_MIN_WRITE_MS ?? 60_000),
)

const lastWritten = new Map<string, { status: ConnectionStatus; at: number }>()

/**
 * Debounced broker connection_status writer — worker is the sole DB writer.
 * Skips no-op updates and enforces a minimum interval per broker id.
 */
export async function writeBrokerConnectionStatus(
  supabase: SupabaseClient,
  brokerId: string,
  status: ConnectionStatus,
  opts?: {
    rawError?: string | null
    errorKind?: BrokerConnectErrorKind | null
    /** Bypass debounce (e.g. clear sticky error fields after heartbeat recovery). */
    force?: boolean
  },
): Promise<void> {
  const now = Date.now()
  const prev = lastWritten.get(brokerId)
  if (
    !opts?.force
    && prev?.status === status
    && now - prev.at < MIN_WRITE_INTERVAL_MS
    && !opts?.rawError
  ) {
    return
  }

  const patch: Record<string, unknown> = { connection_status: status }
  // Keep fxsocket_status aligned so UI badges / Reconnect visibility match worker downs.
  if (status === 'connected') {
    patch.fxsocket_status = 'connected'
    patch.connection_error_kind = null
    patch.connection_error_message = null
    patch.connection_error = null
  } else if (status === 'recovering') {
    patch.fxsocket_status = 'connecting'
    patch.connection_error_kind = null
    patch.connection_error_message = null
    patch.connection_error = null
  } else if (status === 'error') {
    patch.fxsocket_status = 'error'
    if (opts?.rawError) {
      const raw = String(opts.rawError).trim() || 'Broker session is not connected'
      patch.connection_error_kind = opts.errorKind ?? classifyBrokerConnectError(raw)
      patch.connection_error_message = raw
      patch.connection_error = raw
    } else {
      patch.connection_error_kind = 'session_expired'
      patch.connection_error_message = 'session expired'
      patch.connection_error = 'session expired'
    }
  } else if (opts?.rawError) {
    const raw = String(opts.rawError).trim() || 'Broker session is not connected'
    patch.connection_error_kind = opts.errorKind ?? classifyBrokerConnectError(raw)
    patch.connection_error_message = raw
    patch.connection_error = raw
  }

  const { error } = await supabase
    .from('broker_accounts')
    .update(patch)
    .eq('id', brokerId)
  if (error) {
    console.warn(`[brokerConnectionStatus] update failed broker=${brokerId}:`, error.message)
    return
  }
  lastWritten.set(brokerId, { status, at: now })
}

export function clearBrokerConnectionStatusCache(brokerId?: string): void {
  if (brokerId) lastWritten.delete(brokerId)
  else lastWritten.clear()
}
