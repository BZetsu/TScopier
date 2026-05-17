import { MassiveClient } from "../massiveApi.ts"
import type { PricePoint } from "./simulator.ts"
import { barsToMidPoints, quotesToMidPoints } from "./simulator.ts"
import { mapSymbolToMassive, timeframeToAgg } from "./symbolMap.ts"
import type { BacktestRunConfig, ParsedSignalForBacktest } from "./types.ts"

/** Quotes API uses `C:EUR-USD`; aggregates use `C:EURUSD`. */
export function toMassiveQuoteTicker(massiveTicker: string): string {
  if (massiveTicker.startsWith("C:")) {
    const pair = massiveTicker.slice(2)
    if (pair.length === 6 && !pair.includes("-")) {
      return `C:${pair.slice(0, 3)}-${pair.slice(3)}`
    }
  }
  return massiveTicker
}

export interface PreloadedMarketData {
  seriesBySymbol: Map<string, PricePoint[]>
  apiCalls: number
  fetchLog: string[]
}

function signalWindowForSymbol(
  symbol: string,
  signals: ParsedSignalForBacktest[],
  configFromMs: number,
  configToMs: number,
): { fromMs: number; toMs: number } {
  const symSigs = signals.filter((s) => s.symbol === symbol)
  if (!symSigs.length) {
    return { fromMs: configFromMs, toMs: configToMs }
  }
  const minSig = Math.min(...symSigs.map((s) => s.signalAt.getTime()))
  const maxSig = Math.max(...symSigs.map((s) => s.signalAt.getTime()))
  const padBefore = 2 * 24 * 3_600_000
  const padAfter = 14 * 24 * 3_600_000
  return {
    fromMs: Math.max(configFromMs, minSig - padBefore),
    toMs: Math.min(configToMs, maxSig + padAfter),
  }
}

/**
 * Fetch OHLC or forex quotes from Massive for every symbol before simulation.
 * Window is tightened per symbol around actual signal timestamps.
 */
export async function preloadMarketData(
  massive: MassiveClient,
  symbols: string[],
  signals: ParsedSignalForBacktest[],
  config: BacktestRunConfig,
  configFromMs: number,
  configToMs: number,
  callsPerMinute = 5,
): Promise<PreloadedMarketData> {
  const { multiplier, timespan } = timeframeToAgg(config.timeframe)
  const seriesBySymbol = new Map<string, PricePoint[]>()
  const fetchLog: string[] = []
  let apiCalls = 0
  const lowRatePlan = callsPerMinute <= 5

  for (const symbol of symbols) {
    const mapped = mapSymbolToMassive(symbol)
    if (!mapped) {
      fetchLog.push(`${symbol}: no Massive ticker mapping`)
      seriesBySymbol.set(symbol, [])
      continue
    }

    const { fromMs, toMs } = signalWindowForSymbol(symbol, signals, configFromMs, configToMs)
    if (fromMs >= toMs) {
      fetchLog.push(`${symbol}: invalid time window`)
      seriesBySymbol.set(symbol, [])
      continue
    }

    let pts: PricePoint[] = []
    const wantsQuotes = config.executionMode === "tick_quotes" && mapped.assetClass === "forex"
    const useQuotes = wantsQuotes && !lowRatePlan

    if (wantsQuotes && lowRatePlan) {
      fetchLog.push(`${symbol}: tick quotes skipped (plan ≤${callsPerMinute}/min — using OHLC bars)`)
    }

    const rangeLabel = `${new Date(fromMs).toISOString().slice(0, 10)}→${new Date(toMs).toISOString().slice(0, 10)}`

    if (useQuotes) {
      const quoteTicker = toMassiveQuoteTicker(mapped.massiveTicker)
      try {
        const quotes = await massive.getForexQuotes(
          quoteTicker,
          fromMs * 1_000_000,
          toMs * 1_000_000,
          { maxPages: 2 },
        )
        apiCalls += 1
        pts = quotesToMidPoints(quotes)
        fetchLog.push(`${symbol}: ${pts.length} quotes (${quoteTicker}, ${rangeLabel})`)
        if (pts.length === 0) throw new Error("empty quotes")
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fetchLog.push(`${symbol}: quotes failed (${msg}), using bars`)
        const bars = await massive.getAggregates(
          mapped.massiveTicker,
          multiplier,
          timespan,
          fromMs,
          toMs,
          { sort: "asc", maxPages: 12 },
        )
        apiCalls += 1
        pts = barsToMidPoints(bars)
        fetchLog.push(`${symbol}: ${pts.length} bars (${mapped.massiveTicker}, ${rangeLabel})`)
      }
    } else {
      const bars = await massive.getAggregates(
        mapped.massiveTicker,
        multiplier,
        timespan,
        fromMs,
        toMs,
        { sort: "asc", maxPages: 12 },
      )
      apiCalls += 1
      pts = barsToMidPoints(bars)
      fetchLog.push(`${symbol}: ${pts.length} bars (${mapped.massiveTicker}, ${rangeLabel})`)
    }

    seriesBySymbol.set(symbol, pts)
  }

  return { seriesBySymbol, apiCalls, fetchLog }
}
