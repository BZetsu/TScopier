import type { FxsocketPriceBar, FxsocketQuoteTick } from "../fxsocketClient.ts"
import type { PricePoint } from "./simulator.ts"
import type { BacktestTimeframe } from "./types.ts"

/** Map backtest timeframe to FXsocket MT5 labels (M1, M5, H1, D1, …). */
export function toFxsocketTimeframe(tf: BacktestTimeframe): string {
  switch (tf) {
    case "1m": return "M1"
    case "5m": return "M5"
    case "15m": return "M15"
    case "1h": return "H1"
    case "1d": return "D1"
    default: return "M5"
  }
}

/** Normalize signal symbol for broker symbol matching (EURUSD, XAUUSD). */
export function normalizeBacktestSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Match a normalized symbol to an exact broker Market Watch name (handles suffixes). */
export function resolveBrokerSymbol(normalized: string, brokerSymbols: string[]): string | null {
  const target = normalizeBacktestSymbol(normalized)
  if (!target) return null

  for (const sym of brokerSymbols) {
    if (normalizeBacktestSymbol(sym) === target) return sym
  }

  // Prefer shortest exact-prefix match (XAUUSD before XAUUSD.pro)
  const prefixMatches = brokerSymbols
    .filter((sym) => normalizeBacktestSymbol(sym).startsWith(target))
    .sort((a, b) => a.length - b.length)
  if (prefixMatches.length > 0) return prefixMatches[0]!

  for (const sym of brokerSymbols) {
    const norm = normalizeBacktestSymbol(sym)
    if (target.startsWith(norm) || norm.startsWith(target)) return sym
  }

  return null
}

function tickTimestampMs(tick: FxsocketQuoteTick): number {
  if (tick.timeMsc != null && Number.isFinite(tick.timeMsc)) return tick.timeMsc
  const parsed = Date.parse(tick.time)
  return Number.isFinite(parsed) ? parsed : 0
}

/** OHLC bar → bid/ask envelope for conservative intrabar SL/TP checks. */
export function fxsocketBarsToMidPoints(
  bars: FxsocketPriceBar[],
  utcOffsetSeconds = 0,
): PricePoint[] {
  const offsetMs = utcOffsetSeconds * 1000
  return bars
    .map((b) => {
      const ts = Date.parse(b.time)
      if (!Number.isFinite(ts)) return null
      return {
        ts: ts - offsetMs,
        bid: b.low,
        ask: b.high,
        mid: b.close,
      }
    })
    .filter((p): p is PricePoint => p != null)
    .sort((a, b) => a.ts - b.ts)
}

export function fxsocketTicksToMidPoints(
  ticks: FxsocketQuoteTick[],
  utcOffsetSeconds = 0,
): PricePoint[] {
  const offsetMs = utcOffsetSeconds * 1000
  return ticks
    .filter((t) => Number.isFinite(t.bid) && Number.isFinite(t.ask))
    .map((t) => ({
      ts: tickTimestampMs(t) - offsetMs,
      bid: t.bid,
      ask: t.ask,
      mid: (t.bid + t.ask) / 2,
    }))
    .filter((p) => p.ts > 0)
    .sort((a, b) => a.ts - b.ts)
}

/** Format ms as YYYY-MM-DD for FXsocket from/to query params. */
export function msToFxsocketDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** User-facing market data error without internal trace noise. */
export function sanitizeMarketDataErrorMessage(raw: string): string {
  const t = String(raw ?? "").trim()
  if (!t) return "Market data request failed"
  if (/MRPC_TIMEOUT|timed out/i.test(t)) {
    return "Broker history request timed out — MT5 may still be downloading data; try again or use a coarser timeframe."
  }
  if (/CopyRates failed|CopyTicks failed/i.test(t)) {
    return "Broker has no history for this symbol or timeframe — check the symbol is listed in Market Watch."
  }
  if (/rate limit/i.test(t)) {
    return "Market data rate limit — try again in a minute."
  }
  return t
}

export function isRetriableMarketDataError(message: string): boolean {
  return /MRPC_TIMEOUT|timed out|CopyRates failed|CopyTicks failed|download/i.test(message)
}
