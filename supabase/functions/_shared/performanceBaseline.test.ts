import { assertEquals } from "jsr:@std/assert"
import {
  inferPerformanceBaselineFromHistory,
  resolvePerformanceBaselineBalance,
  sumRealizedClosedDealProfit,
  sumRealizedClosedNetProfit,
} from "./performanceBaseline.ts"
import type { FxsocketBrokerTradeRow } from "./fxsocketTrades.ts"

function trade(overrides: Partial<FxsocketBrokerTradeRow>): FxsocketBrokerTradeRow {
  const ticket = overrides.ticket ?? 1
  return {
    id: `broker-1:${ticket}`,
    broker_id: "broker-1",
    broker_label: "Demo",
    broker_name: "IC Markets",
    ticket,
    symbol: "XAUUSD",
    direction: "buy",
    type: "Buy",
    lot_size: 0.1,
    entry_price: 2500,
    sl: null,
    tp: null,
    close_price: 2510,
    profit: 100,
    swap: 0,
    commission: 0,
    comment: null,
    magic: null,
    opened_at: "2026-01-01T10:00:00",
    closed_at: "2026-01-02T10:00:00",
    state: null,
    status: "closed",
    ...overrides,
  }
}

Deno.test("resolvePerformanceBaselineBalance captures balance on first link", () => {
  const baseline = resolvePerformanceBaselineBalance(null, { balance: 10_000, equity: 10_000 })
  assertEquals(baseline, 10_000)
})

Deno.test("resolvePerformanceBaselineBalance skips when baseline already correct", () => {
  const baseline = resolvePerformanceBaselineBalance(10_000, { balance: 12_000 })
  assertEquals(baseline, null)
})

Deno.test("inferPerformanceBaselineFromHistory reconstructs from closed deal profit", () => {
  const trades = [
    trade({ ticket: 1, profit: -500 }),
    trade({ ticket: 2, profit: 200 }),
  ]
  assertEquals(sumRealizedClosedDealProfit(trades), -300)
  assertEquals(sumRealizedClosedNetProfit(trades), -300)
  assertEquals(inferPerformanceBaselineFromHistory(9_700, trades), 10_000)
})

Deno.test("resolvePerformanceBaselineBalance matches MT5 deposit (profit + swap)", () => {
  const trades = [trade({ ticket: 1, profit: -45_378.67, swap: 111.66 })]
  assertEquals(Math.round(sumRealizedClosedNetProfit(trades) * 100) / 100, -45_267.01)
  const baseline = resolvePerformanceBaselineBalance(
    null,
    { balance: 164_732.99, equity: 164_732.99 },
    trades,
  )
  assertEquals(baseline, 210_000)
})

Deno.test("resolvePerformanceBaselineBalance corrects stale baseline missing swap", () => {
  const trades = [trade({ ticket: 1, profit: -45_378.67, swap: 111.66 })]
  const baseline = resolvePerformanceBaselineBalance(
    210_111.66,
    { balance: 164_732.99, equity: 164_732.99 },
    trades,
  )
  assertEquals(baseline, 210_000)
})
