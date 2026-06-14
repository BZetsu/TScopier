import type { MtTrade } from './fxsocketBroker'
import { coerceMtTimestamp, parseMtHistoryTimestamp } from './mtApiDateTime'

/** Normalize broker timestamp fields (unix seconds, numeric strings, ISO). */
export function enrichMtTradeTimestamps(trade: MtTrade): MtTrade {
  const opened = coerceMtTimestamp(trade.opened_at) ?? trade.opened_at
  const closed = coerceMtTimestamp(trade.closed_at) ?? trade.closed_at
  const openedMs = parseMtHistoryTimestamp(opened)
  const closedMs = parseMtHistoryTimestamp(closed)
  return {
    ...trade,
    opened_at: openedMs != null ? new Date(openedMs).toISOString() : trade.opened_at,
    closed_at: closedMs != null ? new Date(closedMs).toISOString() : trade.closed_at,
  }
}

export function enrichMtTradesTimestamps(trades: MtTrade[]): MtTrade[] {
  return trades.map(enrichMtTradeTimestamps)
}
