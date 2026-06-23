import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketTerminalStatus } from './fxsocketClient'

const MIN_WRITE_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.BROKER_TERMINAL_HEALTH_MIN_WRITE_MS ?? 60_000),
)

type HealthSnapshot = {
  terminal_connected: boolean | null
  trade_allowed: boolean | null
}

const lastWritten = new Map<string, { snapshot: HealthSnapshot; at: number }>()

function snapshotFromStatus(status: FxsocketTerminalStatus): HealthSnapshot {
  return {
    terminal_connected: status.connected ?? null,
    trade_allowed: status.tradeAllowed ?? null,
  }
}

function snapshotsEqual(a: HealthSnapshot, b: HealthSnapshot): boolean {
  return a.terminal_connected === b.terminal_connected && a.trade_allowed === b.trade_allowed
}

/**
 * Debounced writer for terminal_connected / trade_allowed from GET /Status.
 */
export async function writeBrokerTerminalHealth(
  supabase: SupabaseClient,
  brokerId: string,
  status: FxsocketTerminalStatus,
  opts?: { force?: boolean },
): Promise<void> {
  const snapshot = snapshotFromStatus(status)
  const now = Date.now()
  const prev = lastWritten.get(brokerId)
  if (
    !opts?.force
    && prev
    && snapshotsEqual(prev.snapshot, snapshot)
    && now - prev.at < MIN_WRITE_INTERVAL_MS
  ) {
    return
  }

  const { error } = await supabase
    .from('broker_accounts')
    .update({
      terminal_connected: snapshot.terminal_connected,
      trade_allowed: snapshot.trade_allowed,
    })
    .eq('id', brokerId)
  if (error) {
    console.warn(`[brokerTerminalHealth] update failed broker=${brokerId}:`, error.message)
    return
  }
  lastWritten.set(brokerId, { snapshot, at: now })
}

export async function writeBrokerTerminalUnhealthy(
  supabase: SupabaseClient,
  brokerId: string,
  opts?: { force?: boolean },
): Promise<void> {
  await writeBrokerTerminalHealth(
    supabase,
    brokerId,
    { connected: false, tradeAllowed: false },
    opts,
  )
}

export function clearBrokerTerminalHealthCache(brokerId?: string): void {
  if (brokerId) lastWritten.delete(brokerId)
  else lastWritten.clear()
}
