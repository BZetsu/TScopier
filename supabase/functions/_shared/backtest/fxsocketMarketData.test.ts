import { assertEquals } from "jsr:@std/assert"
import {
  parsePriceHistoryResponse,
  parseQuoteTicksResponse,
} from "../fxsocketClient.ts"
import {
  fxsocketBarsToMidPoints,
  fxsocketTicksToMidPoints,
  normalizeBacktestSymbol,
  resolveBrokerSymbol,
  toFxsocketTimeframe,
} from "./fxsocketMarketData.ts"

Deno.test("toFxsocketTimeframe maps backtest timeframes to MT5 labels", () => {
  assertEquals(toFxsocketTimeframe("1m"), "M1")
  assertEquals(toFxsocketTimeframe("5m"), "M5")
  assertEquals(toFxsocketTimeframe("15m"), "M15")
  assertEquals(toFxsocketTimeframe("1h"), "H1")
  assertEquals(toFxsocketTimeframe("1d"), "D1")
})

Deno.test("resolveBrokerSymbol matches suffix broker names", () => {
  const symbols = ["EURUSD.sd", "GBPUSD.sd", "XAUUSD.r", "US30.cash"]
  assertEquals(resolveBrokerSymbol("EURUSD", symbols), "EURUSD.sd")
  assertEquals(resolveBrokerSymbol("XAUUSD", symbols), "XAUUSD.r")
  assertEquals(resolveBrokerSymbol("US30", symbols), "US30.cash")
  assertEquals(resolveBrokerSymbol("BTCUSD", symbols), null)
})

Deno.test("normalizeBacktestSymbol strips punctuation", () => {
  assertEquals(normalizeBacktestSymbol("XAU/USD"), "XAUUSD")
  assertEquals(normalizeBacktestSymbol(" eurusd "), "EURUSD")
})

Deno.test("parsePriceHistoryResponse parses FXsocket docs fixture", () => {
  const bars = parsePriceHistoryResponse([{
    time: "2026-06-11T08:00:00Z",
    open: 1.15301,
    high: 1.15348,
    low: 1.15289,
    close: 1.15330,
    tickVolume: 1243,
    realVolume: 0,
    spread: 7,
  }])
  assertEquals(bars.length, 1)
  assertEquals(bars[0]!.close, 1.15330)
  assertEquals(bars[0]!.tickVolume, 1243)
})

Deno.test("fxsocketBarsToMidPoints builds conservative bid/ask envelope", () => {
  const bars = parsePriceHistoryResponse([{
    time: "2026-06-11T08:00:00Z",
    open: 1.15301,
    high: 1.15348,
    low: 1.15289,
    close: 1.15330,
  }])
  const pts = fxsocketBarsToMidPoints(bars, 0)
  assertEquals(pts.length, 1)
  assertEquals(pts[0]!.bid, 1.15289)
  assertEquals(pts[0]!.ask, 1.15348)
  assertEquals(pts[0]!.mid, 1.15330)
})

Deno.test("parseQuoteTicksResponse and fxsocketTicksToMidPoints", () => {
  const ticks = parseQuoteTicksResponse([
    { time: "2026-06-11T08:55:56.728Z", bid: 1.15325, ask: 1.15333 },
    { time: "2026-06-11T08:55:57.100Z", bid: 1.15326, ask: 1.15334 },
  ])
  assertEquals(ticks.length, 2)
  const pts = fxsocketTicksToMidPoints(ticks, 0)
  assertEquals(pts.length, 2)
  assertEquals(pts[0]!.bid, 1.15325)
  assertEquals(pts[1]!.bid, 1.15326)
})
