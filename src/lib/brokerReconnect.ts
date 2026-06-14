import type { BrokerAccount } from '../types/database'
import { isFxsocketLinkedBroker } from './brokerLink'

export function isBrokerSessionHealthy(
  account: Pick<BrokerAccount, 'fxsocket_status' | 'connection_status'>,
): boolean {
  const status = account.fxsocket_status ?? account.connection_status
  return status === 'connected' || status === 'connecting' || status === 'recovering'
}

export function isBrokerSessionConnected(
  account: Pick<BrokerAccount, 'fxsocket_status' | 'connection_status'>,
): boolean {
  const status = account.fxsocket_status ?? account.connection_status
  return status === 'connected'
}

export function brokerCanReconnect(
  account: Pick<BrokerAccount, 'fxsocket_account_id' | 'fxsocket_status' | 'connection_status' | 'is_active'>,
): boolean {
  if (!account.is_active) return false
  const status = account.fxsocket_status ?? account.connection_status
  return isFxsocketLinkedBroker(account) && status === 'error'
}

export function brokerConnectionStatusLabel(
  account: Pick<BrokerAccount, 'is_active' | 'fxsocket_status' | 'connection_status'>,
  labels: {
    statusPaused: string
    statusConnected: string
    statusRecovering: string
    statusDisconnected: string
  },
): string {
  const status = account.fxsocket_status ?? account.connection_status
  if (!account.is_active) {
    if (status === 'connected' || status === 'connecting' || status === 'recovering') {
      const base = status === 'connecting' || status === 'recovering'
        ? labels.statusRecovering
        : labels.statusConnected
      return `${labels.statusPaused} · ${base}`
    }
    return labels.statusPaused
  }
  if (status === 'connected') return labels.statusConnected
  if (status === 'connecting' || status === 'recovering') return labels.statusRecovering
  return labels.statusDisconnected
}

export function brokerConnectionBadgeVariant(
  account: Pick<BrokerAccount, 'is_active' | 'fxsocket_status' | 'connection_status'>,
): 'primary' | 'neutral' | 'error' {
  if (!account.is_active) return 'neutral'
  const status = account.fxsocket_status ?? account.connection_status
  if (status === 'connected' || status === 'connecting' || status === 'recovering') return 'primary'
  return 'error'
}
