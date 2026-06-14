import type { MtTrade } from './fxsocketBroker'

const BASELINE_EPSILON = 0.01

type TradeStatsLike = Pick<
  MtTrade,
  | 'status'
  | 'profit'
  | 'swap'
  | 'commission'
  | 'symbol'
  | 'lot_size'
  | 'direction'
  | 'type'
  | 'opened_at'
  | 'closed_at'
>

function isBalanceOpType(type: string): boolean {
  const t = type.toLowerCase()
  return (
    t.includes('balance') ||
    t.includes('credit') ||
    t.includes('deposit') ||
    t.includes('withdraw') ||
    t.includes('correction') ||
    t.includes('transfer')
  )
}

function isTradeableMtRow(row: TradeStatsLike): boolean {
  if (!(row.symbol ?? '').trim()) return false
  if (isBalanceOpType(row.type ?? '')) return false
  const dir = (row.direction ?? '').toLowerCase()
  if ((row.lot_size ?? 0) <= 0) return false
  return dir === 'buy' || dir === 'sell'
}

function isTradeableClosedRow(row: TradeStatsLike): boolean {
  if ((row.status ?? 'closed') !== 'closed') return false
  return isTradeableMtRow(row)
}

function isBalanceCashFlowRow(row: TradeStatsLike): boolean {
  if ((row.status ?? 'closed') !== 'closed') return false
  if (isTradeableClosedRow(row)) return false
  const profit = row.profit
  if (typeof profit !== 'number' || !Number.isFinite(profit) || profit === 0) return false
  return isBalanceOpType(row.type ?? '')
}

function closedDealProfit(row: TradeStatsLike): number | null {
  const p = row.profit
  if (typeof p !== 'number' || !Number.isFinite(p)) return null
  return p
}

function isMtClosedDealForOutcome(row: TradeStatsLike): boolean {
  if ((row.status ?? 'closed') !== 'closed') return false
  if (!isTradeableClosedRow(row)) return false
  return closedDealProfit(row) != null
}

function netClosedLegProfit(row: Pick<MtTrade, 'profit' | 'swap' | 'commission'>): number {
  const p = typeof row.profit === 'number' && Number.isFinite(row.profit) ? row.profit : 0
  const s = typeof row.swap === 'number' && Number.isFinite(row.swap) ? row.swap : 0
  const c = typeof row.commission === 'number' && Number.isFinite(row.commission) ? row.commission : 0
  return p + s + c
}

function rowCloseMs(row: Pick<MtTrade, 'closed_at' | 'opened_at'>): number {
  const iso = row.closed_at ?? row.opened_at
  if (!iso) return Number.POSITIVE_INFINITY
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

export function sumRealizedClosedNetProfit(trades: MtTrade[]): number {
  return trades
    .filter(isMtClosedDealForOutcome)
    .reduce((sum, t) => sum + netClosedLegProfit(t), 0)
}

export function splitBalanceCashFlows(trades: MtTrade[]): {
  initialDeposit: number
  subsequentCashFlow: number
} {
  const cashRows = trades
    .filter(isBalanceCashFlowRow)
    .sort((a, b) => rowCloseMs(a) - rowCloseMs(b))

  if (cashRows.length === 0) {
    return { initialDeposit: 0, subsequentCashFlow: 0 }
  }

  const firstTradeMs = trades
    .filter(isMtClosedDealForOutcome)
    .reduce((min, row) => Math.min(min, rowCloseMs(row)), Number.POSITIVE_INFINITY)

  let initialDeposit = 0
  let subsequentCashFlow = 0

  for (const row of cashRows) {
    const profit = row.profit ?? 0
    const at = rowCloseMs(row)
    if (profit > 0 && at <= firstTradeMs) {
      initialDeposit += profit
      continue
    }
    subsequentCashFlow += profit
  }

  return { initialDeposit, subsequentCashFlow }
}

export function inferPerformanceBaselineFromHistory(
  currentBalance: number,
  trades: MtTrade[],
): number {
  const netPnl = sumRealizedClosedNetProfit(trades)
  const { initialDeposit, subsequentCashFlow } = splitBalanceCashFlows(trades)
  const inferred = currentBalance - netPnl - subsequentCashFlow

  if (initialDeposit > 0) {
    const depositResidual = Math.abs(currentBalance - initialDeposit - netPnl)
    if (depositResidual <= BASELINE_EPSILON) {
      return Math.round(initialDeposit * 100) / 100
    }
    if (inferred < initialDeposit - BASELINE_EPSILON) {
      return Math.round(initialDeposit * 100) / 100
    }
  }

  return Math.round(inferred * 100) / 100
}

export function computePerformanceBaselineBalance(
  balance: number | null | undefined,
  trades: MtTrade[],
): number | null {
  if (balance == null || !Number.isFinite(balance) || balance <= 0) return null
  if (!trades.length || !trades.some(isMtClosedDealForOutcome)) return balance
  return inferPerformanceBaselineFromHistory(balance, trades)
}

/** Best initial balance for display — corrects stale DB baselines using live balance + MT history. */
export function resolveDisplayInitialBalance(
  storedBaseline: number | null | undefined,
  currentBalance: number | null | undefined,
  trades: MtTrade[],
  brokerId: string,
): number | null {
  const balance =
    currentBalance != null && Number.isFinite(Number(currentBalance))
      ? Number(currentBalance)
      : null
  const stored =
    storedBaseline != null && Number.isFinite(Number(storedBaseline)) && Number(storedBaseline) > 0
      ? Number(storedBaseline)
      : null

  const brokerTrades = trades.filter(t => t.broker_id === brokerId)
  const computed = computePerformanceBaselineBalance(balance, brokerTrades)
  if (computed == null) return stored

  if (balance != null && brokerTrades.some(isMtClosedDealForOutcome)) {
    const netPnl = sumRealizedClosedNetProfit(brokerTrades)
    const { initialDeposit, subsequentCashFlow } = splitBalanceCashFlows(brokerTrades)

    if (initialDeposit > 0) {
      const depositResidual = Math.abs(balance - initialDeposit - netPnl - subsequentCashFlow)
      if (depositResidual <= BASELINE_EPSILON) {
        return Math.round(initialDeposit * 100) / 100
      }
      // Recorded MT5 deposit deal overrides a stale inferred baseline.
      if (stored == null || initialDeposit > stored + BASELINE_EPSILON) {
        return Math.round(initialDeposit * 100) / 100
      }
    }

    if (computed != null && stored != null && Math.abs(stored - computed) > BASELINE_EPSILON) {
      return computed
    }
  }

  if (stored == null) return computed
  return Math.abs(stored - computed) <= BASELINE_EPSILON ? stored : computed
}
