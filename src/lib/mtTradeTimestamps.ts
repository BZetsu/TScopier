import type { MtTrade } from './fxsocketBroker'
import { fxsocketBroker } from './fxsocketBroker'
import { getLocalCalendarDayBounds } from './dashboardTradeStats'
import { formatLocalMtApiDateTime, parseMtHistoryTimestamp } from './mtApiDateTime'
import { TRADES_PAGE_HISTORY_DAYS } from './tradesConstants'
import {
  flattenMtOrder,
  resolveMtCloseTimestamp,
  resolveMtOpenTimestamp,
  resolveMtPositionId,
  resolveMtTicket,
} from './mtTradeFieldsClient'

export type TicketTimeLookup = Map<number, { opened_at: string | null; closed_at: string | null }>

function mergeLookupEntry(
  lookup: TicketTimeLookup,
  ticket: number,
  opened: string | null,
  closed: string | null,
): void {
  if (ticket <= 0) return
  const prev = lookup.get(ticket)
  lookup.set(ticket, {
    opened_at: opened ?? prev?.opened_at ?? null,
    closed_at: closed ?? prev?.closed_at ?? null,
  })
}

/** True when the Trades table would show "—" for TIME. */
export function mtTradeMissingDisplayTime(trade: MtTrade): boolean {
  return parseMtHistoryTimestamp(resolveTradeDisplayTimeRaw(trade)) == null
}

/** Close time for closed legs; open time for open legs. Only returns parseable values. */
export function resolveTradeDisplayTimeRaw(trade: MtTrade): string | number | null | undefined {
  if (trade.status === 'closed') {
    if (parseMtHistoryTimestamp(trade.closed_at) != null) return trade.closed_at
    if (parseMtHistoryTimestamp(trade.opened_at) != null) return trade.opened_at
    return null
  }
  if (parseMtHistoryTimestamp(trade.opened_at) != null) return trade.opened_at
  return null
}

function coerceValidIso(value: string | null | undefined): string | null {
  const ms = parseMtHistoryTimestamp(value)
  return ms != null ? new Date(ms).toISOString() : null
}

/** Normalize broker timestamp fields (unix seconds, numeric strings, ISO). */
export function enrichMtTradeTimestamps(trade: MtTrade): MtTrade {
  return {
    ...trade,
    opened_at: coerceValidIso(trade.opened_at),
    closed_at: coerceValidIso(trade.closed_at),
  }
}

export function enrichMtTradesTimestamps(trades: MtTrade[]): MtTrade[] {
  return trades.map(enrichMtTradeTimestamps)
}

export function buildTicketTimeLookup(orders: unknown[]): TicketTimeLookup {
  const lookup: TicketTimeLookup = new Map()

  for (const order of orders) {
    if (!order || typeof order !== 'object') continue
    const row = flattenMtOrder(order)
    const ticket = resolveMtTicket(row)
    const positionId = resolveMtPositionId(row)
    const opened = resolveMtOpenTimestamp(row)
    const closed = resolveMtCloseTimestamp(row)

    mergeLookupEntry(lookup, ticket, opened, closed)
    mergeLookupEntry(lookup, positionId, opened, closed)
  }

  return lookup
}

/** FxSocket PositionHistory rows include explicit closeTime per round-trip. */
export function buildPositionTimeLookup(positions: unknown[]): TicketTimeLookup {
  const lookup: TicketTimeLookup = new Map()

  for (const position of positions) {
    if (!position || typeof position !== 'object') continue
    const row = flattenMtOrder(position)
    const positionId = resolveMtPositionId(row)
    const opened = resolveMtOpenTimestamp(row)
    const closed = resolveMtCloseTimestamp(row)
    mergeLookupEntry(lookup, positionId, opened, closed)
  }

  return lookup
}

function mergeTicketTimeLookups(...maps: TicketTimeLookup[]): TicketTimeLookup {
  const out: TicketTimeLookup = new Map()
  for (const map of maps) {
    for (const [ticket, times] of map) {
      mergeLookupEntry(out, ticket, times.opened_at, times.closed_at)
    }
  }
  return out
}

function lookupCloseTime(lookup: TicketTimeLookup | undefined, trade: MtTrade): string | null {
  if (!lookup) return null
  const byTicket = lookup.get(trade.ticket)
  const byPosition =
    trade.position_ticket != null && trade.position_ticket > 0
      ? lookup.get(trade.position_ticket)
      : undefined
  return byTicket?.closed_at ?? byPosition?.closed_at ?? null
}

function lookupOpenTime(lookup: TicketTimeLookup | undefined, trade: MtTrade): string | null {
  if (!lookup) return null
  const byTicket = lookup.get(trade.ticket)
  const byPosition =
    trade.position_ticket != null && trade.position_ticket > 0
      ? lookup.get(trade.position_ticket)
      : undefined
  return byTicket?.opened_at ?? byPosition?.opened_at ?? null
}

/** Apply broker close times to every closed trade row. */
export function applyCloseTimesToTrades(
  trades: MtTrade[],
  lookupsByBroker: Record<string, TicketTimeLookup>,
): MtTrade[] {
  return trades.map(trade => {
    if (trade.status !== 'closed') return enrichMtTradeTimestamps(trade)

    const lookup = lookupsByBroker[trade.broker_id]
    const closedFromLookup = lookupCloseTime(lookup, trade)
    const openedFromLookup = lookupOpenTime(lookup, trade)

    return enrichMtTradeTimestamps({
      ...trade,
      closed_at: closedFromLookup ?? trade.closed_at,
      opened_at: openedFromLookup ?? trade.opened_at,
    })
  })
}

function tradesHistoryRange(): { from: string; to: string } {
  const { tomorrowStart: historyTo } = getLocalCalendarDayBounds()
  const historyFrom = new Date()
  historyFrom.setDate(historyFrom.getDate() - TRADES_PAGE_HISTORY_DAYS)
  return {
    from: formatLocalMtApiDateTime(historyFrom),
    to: formatLocalMtApiDateTime(historyTo),
  }
}

/** Fill close times from FxSocket OrderHistory + PositionHistory (source of truth for TIME column). */
export async function hydrateMtTradesTimesFromBrokers(trades: MtTrade[]): Promise<MtTrade[]> {
  const closed = trades.filter(t => t.status === 'closed')
  if (closed.length === 0) return trades

  const brokerIds = [...new Set(closed.map(t => t.broker_id).filter(Boolean))]
  if (brokerIds.length === 0) return trades

  const { from, to } = tradesHistoryRange()
  const lookupsByBroker: Record<string, TicketTimeLookup> = {}

  await Promise.all(
    brokerIds.map(async brokerId => {
      const [ordersRes, positionsRes] = await Promise.allSettled([
        fxsocketBroker.orderHistory({ accountId: brokerId, from, to }),
        fxsocketBroker.positionHistory({ accountId: brokerId, from, to }),
      ])

      const orderLookup =
        ordersRes.status === 'fulfilled' ? buildTicketTimeLookup(ordersRes.value) : new Map()
      const positionLookup =
        positionsRes.status === 'fulfilled' ? buildPositionTimeLookup(positionsRes.value) : new Map()

      lookupsByBroker[brokerId] = mergeTicketTimeLookups(orderLookup, positionLookup)
    }),
  )

  return applyCloseTimesToTrades(trades, lookupsByBroker)
}

export function formatTradeTimeLabel(iso: string | number | null | undefined): string {
  const ms = parseMtHistoryTimestamp(iso)
  if (ms == null) return '—'
  return new Date(ms).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Label for closed-trade TIME column (close time only). */
export function formatTradeCloseTimeLabel(trade: MtTrade): string {
  if (trade.status !== 'closed') {
    return formatTradeTimeLabel(resolveTradeDisplayTimeRaw(trade))
  }
  const closedMs = parseMtHistoryTimestamp(trade.closed_at)
  if (closedMs != null) return formatTradeTimeLabel(trade.closed_at)
  return formatTradeTimeLabel(resolveTradeDisplayTimeRaw(trade))
}
