import type { FxsocketAccountSummary } from "./fxsocketClient.ts"
import type { FxsocketBrokerTradeRow } from "./fxsocketTrades.ts"

/** Match frontend PERFORMANCE_MT_HISTORY_DAYS for cash-flow / deal-profit backfill. */
export const PERFORMANCE_BASELINE_HISTORY_DAYS = 400

const BASELINE_EPSILON = 0.01

type TradeStatsLike = Pick<
  FxsocketBrokerTradeRow,
  "status" | "profit" | "swap" | "commission" | "symbol" | "lot_size" | "direction" | "type"
>

function isTradeableMtRow(row: TradeStatsLike): boolean {
  if (!(row.symbol ?? "").trim()) return false
  const type = (row.type ?? "").toLowerCase()
  if (
    type.includes("balance") ||
    type.includes("credit") ||
    type.includes("deposit") ||
    type.includes("withdraw") ||
    type.includes("correction") ||
    type.includes("transfer")
  ) {
    return false
  }
  const dir = (row.direction ?? "").toLowerCase()
  if ((row.lot_size ?? 0) <= 0) return false
  return dir === "buy" || dir === "sell"
}

function isTradeableClosedRow(row: TradeStatsLike): boolean {
  if ((row.status ?? "closed") !== "closed") return false
  return isTradeableMtRow(row)
}

function isBalanceCashFlowRow(row: TradeStatsLike): boolean {
  if ((row.status ?? "closed") !== "closed") return false
  if (isTradeableClosedRow(row)) return false
  const profit = row.profit
  if (typeof profit !== "number" || !Number.isFinite(profit) || profit === 0) return false

  const type = (row.type ?? "").toLowerCase()
  if (
    type.includes("balance") ||
    type.includes("credit") ||
    type.includes("deposit") ||
    type.includes("withdraw") ||
    type.includes("correction") ||
    type.includes("transfer")
  ) {
    return true
  }
  return (row.lot_size ?? 0) <= 0 && !(row.symbol ?? "").trim()
}

function closedDealProfit(row: TradeStatsLike): number | null {
  const p = row.profit
  if (typeof p !== "number" || !Number.isFinite(p)) return null
  return p
}

function isMtClosedDealForOutcome(row: TradeStatsLike): boolean {
  if ((row.status ?? "closed") !== "closed") return false
  if (!isTradeableClosedRow(row)) return false
  return closedDealProfit(row) != null
}

function netClosedLegProfit(row: Pick<FxsocketBrokerTradeRow, "profit" | "swap" | "commission">): number {
  const p = typeof row.profit === "number" && Number.isFinite(row.profit) ? row.profit : 0
  const s = typeof row.swap === "number" && Number.isFinite(row.swap) ? row.swap : 0
  const c = typeof row.commission === "number" && Number.isFinite(row.commission) ? row.commission : 0
  return p + s + c
}

export function sumBalanceCashFlow(trades: FxsocketBrokerTradeRow[]): number {
  return trades
    .filter(isBalanceCashFlowRow)
    .reduce((sum, t) => sum + (t.profit ?? 0), 0)
}

/** Deal profit column only (matches MT5 History "Profit" row). */
export function sumRealizedClosedDealProfit(trades: FxsocketBrokerTradeRow[]): number {
  return trades
    .filter(isMtClosedDealForOutcome)
    .reduce((sum, t) => sum + (closedDealProfit(t) ?? 0), 0)
}

/** Profit + swap + commission — what actually moves account balance per closed leg. */
export function sumRealizedClosedNetProfit(trades: FxsocketBrokerTradeRow[]): number {
  return trades
    .filter(isMtClosedDealForOutcome)
    .reduce((sum, t) => sum + netClosedLegProfit(t), 0)
}

/**
 * Reconstruct deposit / starting balance from current balance and closed history.
 * MT5: Balance = Deposit + Profit + Swap + Commission (+ later cash flows).
 */
export function inferPerformanceBaselineFromHistory(
  currentBalance: number,
  trades: FxsocketBrokerTradeRow[],
): number {
  const netPnl = sumRealizedClosedNetProfit(trades)
  const cashFlow = sumBalanceCashFlow(trades)
  return Math.round((currentBalance - netPnl - cashFlow) * 100) / 100
}

export function hasPerformanceBaseline(value: number | null | undefined): boolean {
  if (value == null) return false
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export function computePerformanceBaselineBalance(
  summary: FxsocketAccountSummary,
  trades?: FxsocketBrokerTradeRow[],
): number | null {
  const balanceRaw = summary.balance ?? summary.equity
  if (balanceRaw == null || !Number.isFinite(Number(balanceRaw))) return null
  const balance = Number(balanceRaw)
  if (balance <= 0) return null

  if (!trades?.length || !trades.some(isMtClosedDealForOutcome)) return balance

  return inferPerformanceBaselineFromHistory(balance, trades)
}

/**
 * Returns the baseline balance to persist, or null when no update is needed / possible.
 * New links capture current balance; accounts with history reconstruct the MT5 deposit.
 * Corrects a stored baseline when history math differs (e.g. after formula fixes).
 */
export function resolvePerformanceBaselineBalance(
  existing: number | null | undefined,
  summary: FxsocketAccountSummary,
  trades?: FxsocketBrokerTradeRow[],
): number | null {
  const computed = computePerformanceBaselineBalance(summary, trades)
  if (computed == null) return null

  if (!hasPerformanceBaseline(existing)) return computed

  const canInferFromHistory = Boolean(trades?.length && trades.some(isMtClosedDealForOutcome))
  if (!canInferFromHistory) return null

  const stored = Number(existing)
  if (Math.abs(stored - computed) <= BASELINE_EPSILON) return null
  return computed
}
