import type { SimulatedTradeResult, TradeOutcome } from "./types.ts"

export interface DbBacktestTradeRow {
  id: string
  run_id: string
  signal_id: string | null
  channel_id: string | null
  symbol: string
  direction: string
  signal_at: string
  entry_price: number | string
  sl: number | string | null
  tp_levels: number[] | string[] | null
  lot_size: number | string
  outcome: string
  tps_hit: number
  exit_price: number | string | null
  closed_at: string | null
  pnl: number | string
  pnl_r: number | string | null
  max_favorable_excursion: number | string | null
  max_adverse_excursion: number | string | null
  details: Record<string, unknown> | null
}

export interface TradeOverrides {
  direction?: "buy" | "sell"
  entry_price?: number
  sl?: number | null
  tp_levels?: number[]
}

export function parseTpLevels(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0)
}

export function dbTradeToSimulated(row: DbBacktestTradeRow): SimulatedTradeResult {
  const details = (row.details ?? {}) as Record<string, unknown>
  const pipPnl = details.pipPnl != null ? Number(details.pipPnl) : null
  return {
    signalId: String(details.backtestChannelSignalId ?? row.id),
    copierSignalId: row.signal_id,
    channelId: row.channel_id ?? "",
    symbol: row.symbol,
    direction: row.direction === "sell" ? "sell" : "buy",
    signalAt: new Date(row.signal_at),
    entryPrice: Number(row.entry_price),
    sl: row.sl != null ? Number(row.sl) : null,
    tpLevels: parseTpLevels(row.tp_levels),
    lotSize: Number(row.lot_size) > 0 ? Number(row.lot_size) : 0.01,
    outcome: row.outcome as TradeOutcome,
    tpsHit: row.tps_hit ?? 0,
    exitPrice: row.exit_price != null ? Number(row.exit_price) : null,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    pnl: Number(row.pnl),
    pipPnl: Number.isFinite(pipPnl) ? pipPnl : null,
    pnlR: row.pnl_r != null ? Number(row.pnl_r) : null,
    mfe: Number(row.max_favorable_excursion ?? 0),
    mae: Number(row.max_adverse_excursion ?? 0),
    details,
  }
}

export function simulatedToTradeRow(
  sim: SimulatedTradeResult,
  runId: string,
  existing: DbBacktestTradeRow,
): Record<string, unknown> {
  return {
    run_id: runId,
    signal_id: existing.signal_id,
    channel_id: existing.channel_id,
    symbol: sim.symbol,
    direction: sim.direction,
    signal_at: sim.signalAt.toISOString(),
    entry_price: sim.entryPrice,
    sl: sim.sl,
    tp_levels: sim.tpLevels,
    lot_size: sim.lotSize,
    outcome: sim.outcome,
    tps_hit: sim.tpsHit,
    exit_price: sim.exitPrice,
    closed_at: sim.closedAt?.toISOString() ?? null,
    pnl: sim.pnl,
    pnl_r: sim.pnlR,
    max_favorable_excursion: sim.mfe,
    max_adverse_excursion: sim.mae,
    details: {
      ...((existing.details ?? {}) as Record<string, unknown>),
      ...sim.details,
      backtestChannelSignalId: sim.signalId,
      pipPnl: sim.details.pipPnl ?? sim.pipPnl,
    },
  }
}
