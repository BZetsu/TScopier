/** One reconnect attempt per broker at a time; minimum gap between edge calls. */

const inFlight = new Set<string>()
const lastAttemptAt = new Map<string, number>()

const MIN_GAP_MS = Math.max(3_000, Number(import.meta.env.VITE_BROKER_RECONNECT_MIN_GAP_MS ?? 8_000) || 8_000)

export function brokerReconnectInFlight(brokerId: string): boolean {
  return inFlight.has(brokerId)
}

export function tryBeginBrokerReconnect(brokerId: string): boolean {
  if (inFlight.has(brokerId)) return false
  const last = lastAttemptAt.get(brokerId) ?? 0
  if (Date.now() - last < MIN_GAP_MS) return false
  inFlight.add(brokerId)
  lastAttemptAt.set(brokerId, Date.now())
  return true
}

export function endBrokerReconnect(brokerId: string): void {
  inFlight.delete(brokerId)
}
