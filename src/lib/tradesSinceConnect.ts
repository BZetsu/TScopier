import type { MtTrade } from './fxsocketBroker'
import { parseMtHistoryTimestamp } from './mtApiDateTime'
import type { BrokerAccount } from '../types/database'

export type BrokerConnectAnchor = Pick<
  BrokerAccount,
  'id' | 'performance_baseline_captured_at' | 'created_at'
>

/** UTC ms when TSCopier first linked this broker (baseline capture, else account created). */
export function resolveBrokerConnectMs(
  account: Pick<BrokerAccount, 'performance_baseline_captured_at'> & {
    created_at?: string | null
  },
): number | null {
  const raw = account.performance_baseline_captured_at?.trim() || account.created_at?.trim()
  if (!raw) return null
  return parseMtHistoryTimestamp(raw)
}

export function buildBrokerConnectMsMap(
  accounts: readonly BrokerConnectAnchor[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const account of accounts) {
    const ms = resolveBrokerConnectMs(account)
    if (ms != null) out.set(account.id, ms)
  }
  return out
}

/** When trade activity started for since-connect filtering (open time preferred). */
export function resolveMtTradeSinceConnectMs(trade: MtTrade): number | null {
  const opened = parseMtHistoryTimestamp(trade.opened_at)
  if (opened != null) return opened
  if (trade.status === 'closed') {
    return parseMtHistoryTimestamp(trade.closed_at)
  }
  return null
}

export function isMtTradeSinceConnect(
  trade: MtTrade,
  connectMsByBrokerId: ReadonlyMap<string, number>,
): boolean {
  const connectMs = connectMsByBrokerId.get(trade.broker_id)
  if (connectMs == null) return true

  const activityMs = resolveMtTradeSinceConnectMs(trade)
  if (activityMs == null) return trade.status === 'open'
  return activityMs >= connectMs
}

export function filterMtTradesSinceConnect(
  trades: MtTrade[],
  accounts: readonly BrokerConnectAnchor[],
): MtTrade[] {
  if (trades.length === 0 || accounts.length === 0) return trades
  const connectMsByBrokerId = buildBrokerConnectMsMap(accounts)
  if (connectMsByBrokerId.size === 0) return trades
  return trades.filter(trade => isMtTradeSinceConnect(trade, connectMsByBrokerId))
}

export type TradeStatsConnectRow = {
  status?: string
  closed_at: string | null
  opened_at?: string | null
}

/** When trade activity started for stats rows (open time preferred). */
export function resolveTradeStatsSinceConnectMs(row: TradeStatsConnectRow): number | null {
  const opened = parseMtHistoryTimestamp(row.opened_at)
  if (opened != null) return opened
  if ((row.status ?? 'closed') === 'closed') {
    return parseMtHistoryTimestamp(row.closed_at)
  }
  return null
}

export function isTradeStatsRowSinceConnect(row: TradeStatsConnectRow, connectMs: number): boolean {
  const activityMs = resolveTradeStatsSinceConnectMs(row)
  if (activityMs == null) return (row.status ?? 'closed') === 'open'
  return activityMs >= connectMs
}

export function filterTradeStatsRowsSinceConnect<T extends TradeStatsConnectRow>(
  rows: T[],
  account: Pick<BrokerAccount, 'performance_baseline_captured_at'> & {
    created_at?: string | null
  },
): T[] {
  const connectMs = resolveBrokerConnectMs(account)
  if (connectMs == null) return rows
  return rows.filter(row => isTradeStatsRowSinceConnect(row, connectMs))
}
