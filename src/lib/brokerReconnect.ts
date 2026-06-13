import type { BrokerAccount } from '../types/database'
import { isMtSessionUuid } from './brokerLink'
import { brokerNeedsPasswordForReconnectMessage } from './brokerConnectError'

/** Session is up or the Connection Keeper is actively recovering it. */
export function isBrokerSessionHealthy(
  account: Pick<BrokerAccount, 'connection_status'>,
): boolean {
  return account.connection_status === 'connected' || account.connection_status === 'recovering'
}

/** True only when the DB session flag is explicitly connected. */
export function isBrokerSessionConnected(
  account: Pick<BrokerAccount, 'connection_status'>,
): boolean {
  return account.connection_status === 'connected'
}

export function isBrokerSessionRecovering(
  account: Pick<BrokerAccount, 'connection_status'>,
): boolean {
  return account.connection_status === 'recovering'
}

/** Broker needs manual reconnect (error state with a restorable session id). */
export function brokerCanReconnect(
  account: Pick<BrokerAccount, 'metaapi_account_id' | 'connection_status'>,
): boolean {
  return isMtSessionUuid(account.metaapi_account_id) && account.connection_status === 'error'
}

export function brokerNeedsPasswordForReconnect(message: string | undefined): boolean {
  return brokerNeedsPasswordForReconnectMessage(message)
}

/** User-facing connection label for broker list rows (active accounts only). */
export function brokerConnectionStatusLabel(
  account: Pick<BrokerAccount, 'is_active' | 'connection_status'>,
  labels: {
    statusPaused: string
    statusConnected: string
    statusRecovering: string
    statusDisconnected: string
  },
): string {
  if (!account.is_active) {
    if (isBrokerSessionHealthy(account)) {
      const base = isBrokerSessionRecovering(account) ? labels.statusRecovering : labels.statusConnected
      return `${labels.statusPaused} · ${base}`
    }
    return labels.statusPaused
  }
  if (isBrokerSessionConnected(account)) return labels.statusConnected
  if (isBrokerSessionRecovering(account)) return labels.statusRecovering
  return labels.statusDisconnected
}

/** Badge variant for broker list connection state. */
export function brokerConnectionBadgeVariant(
  account: Pick<BrokerAccount, 'is_active' | 'connection_status'>,
): 'primary' | 'neutral' | 'error' {
  if (!account.is_active) return 'neutral'
  if (isBrokerSessionHealthy(account)) return 'primary'
  return 'error'
}
