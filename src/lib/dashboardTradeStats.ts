/** Shared filters for dashboard closed-trade P/L and win/loss counts. */

export type TradeStatsRow = {
  status: string
  profit: number | null
  closed_at: string | null
  symbol: string
  lot_size: number
  direction?: string
  type?: string
  swap?: number | null
  commission?: number | null
}

export function isTradeableClosedRow(row: {
  status: string
  symbol: string
  lot_size: number
  direction?: string
  type?: string
}): boolean {
  if (row.status !== 'closed') return false
  if (!(row.symbol ?? '').trim()) return false
  const type = (row.type ?? '').toLowerCase()
  if (
    type.includes('balance') ||
    type.includes('credit') ||
    type.includes('deposit') ||
    type.includes('withdraw') ||
    type.includes('correction') ||
    type.includes('transfer')
  ) {
    return false
  }
  const dir = (row.direction ?? '').toLowerCase()
  if (dir === 'buy' || dir === 'sell') return true
  return (row.lot_size ?? 0) > 0
}

export function netClosedLegProfit(row: {
  profit: number | null
  swap?: number | null
  commission?: number | null
}): number {
  const p = typeof row.profit === 'number' && Number.isFinite(row.profit) ? row.profit : 0
  const s = typeof row.swap === 'number' && Number.isFinite(row.swap) ? row.swap : 0
  const c = typeof row.commission === 'number' && Number.isFinite(row.commission) ? row.commission : 0
  return p + s + c
}

/** Sum realized P/L for closed buy/sell legs that finished in the given window. */
export function sumTradeableClosedProfitInRange(
  rows: TradeStatsRow[],
  closedBetween: (closedAt: string | null) => boolean,
): number {
  return rows
    .filter(t => isTradeableClosedRow(t) && closedBetween(t.closed_at))
    .reduce((sum, t) => sum + netClosedLegProfit(t), 0)
}

/** Closed buy/sell positions that finished in the window (by `closed_at`). */
export function countClosedTradeOutcomesInRange(
  rows: TradeStatsRow[],
  closedBetween: (closedAt: string | null) => boolean,
): { taken: number; won: number; lost: number } {
  const closed = rows.filter(t => isTradeableClosedRow(t) && closedBetween(t.closed_at))
  return {
    taken: closed.length,
    won: closed.filter(t => netClosedLegProfit(t) > 0).length,
    lost: closed.filter(t => netClosedLegProfit(t) < 0).length,
  }
}
