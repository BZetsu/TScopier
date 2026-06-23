import type { BrokerAccount } from '../types/database'

export type BrokerTerminalHealthPhase = 'healthy' | 'unhealthy' | 'checking' | 'paused'

type BrokerTerminalHealthLabels = {
  statusHealthy: string
  statusUnhealthy: string
  statusHealthChecking: string
}

function isBrokerLinking(
  account: Pick<BrokerAccount, 'connection_status' | 'fxsocket_status'>,
): boolean {
  if (account.connection_status === 'pending') return true
  const fx = account.fxsocket_status
  return fx === 'connecting'
}

export function brokerTerminalHealthPhase(
  account: Pick<
    BrokerAccount,
    'is_active' | 'connection_status' | 'fxsocket_status' | 'terminal_connected' | 'trade_allowed'
  >,
): BrokerTerminalHealthPhase {
  if (!account.is_active) return 'paused'
  if (isBrokerLinking(account)) return 'checking'
  if (account.terminal_connected == null || account.trade_allowed == null) return 'checking'
  if (account.terminal_connected === true && account.trade_allowed === true) {
    return 'healthy'
  }
  return 'unhealthy'
}

export function brokerTerminalHealthLabel(
  account: Pick<
    BrokerAccount,
    'is_active' | 'connection_status' | 'fxsocket_status' | 'terminal_connected' | 'trade_allowed'
  >,
  labels: BrokerTerminalHealthLabels,
): string | null {
  const phase = brokerTerminalHealthPhase(account)
  if (phase === 'paused') return null
  if (phase === 'healthy') return labels.statusHealthy
  if (phase === 'unhealthy') return labels.statusUnhealthy
  return labels.statusHealthChecking
}

export function brokerTerminalHealthBadgeVariant(
  account: Pick<
    BrokerAccount,
    'is_active' | 'connection_status' | 'fxsocket_status' | 'terminal_connected' | 'trade_allowed'
  >,
): 'primary' | 'error' | 'neutral' | null {
  const phase = brokerTerminalHealthPhase(account)
  if (phase === 'paused') return null
  if (phase === 'healthy') return 'primary'
  if (phase === 'unhealthy') return 'error'
  return 'neutral'
}
