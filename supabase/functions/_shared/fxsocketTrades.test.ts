import { assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  allSettledBounded,
  fetchClosedHistoryForBaseline,
  fetchFxsocketBrokerTrades,
  fetchTradesListFromOrderHistory,
  HISTORY_CHUNK_CONCURRENCY,
  mapPositionHistoryRow,
  type MtHistorySource,
} from "./fxsocketTrades.ts"

const broker = {
  id: "broker-1",
  label: "Demo",
  broker_name: "FxPro",
}

const sessionBroker = {
  id: "broker-mtapi",
  label: "MT5 • 476205231",
  broker_name: null,
  platform: "MT5",
  fxsocket_account_id: "sess-mtapi-1",
}

const swaggerPositionRow = {
  positionId: 1679874108,
  symbol: "XAUUSD",
  type: "Sell",
  volume: 0.01,
  openTime: "2026-06-02T10:55:57.000Z",
  openPrice: 4532.59,
  closeTime: "2026-06-02T11:13:04.000Z",
  closePrice: 4536.6,
  profit: -4.01,
  swap: 0,
  commission: 0,
  netProfit: -4.01,
  magic: 1780386957639,
  comment: "TScopier:SIGNALSPRO:146acbf8",
}

Deno.test("mapPositionHistoryRow: Swagger fixture maps timestamps and lot size", () => {
  const trade = mapPositionHistoryRow(swaggerPositionRow, broker)
  assertNotEquals(trade, null)
  assertEquals(trade!.ticket, 1679874108)
  assertEquals(trade!.position_ticket, 1679874108)
  assertEquals(trade!.opened_at, "2026-06-02T10:55:57.000Z")
  assertEquals(trade!.closed_at, "2026-06-02T11:13:04.000Z")
  assertEquals(trade!.lot_size, 0.01)
  assertEquals(trade!.symbol, "XAUUSD")
  assertEquals(trade!.direction, "sell")
  assertEquals(trade!.profit, -4.01)
  assertEquals(trade!.status, "closed")
})

Deno.test("mapPositionHistoryRow: two positions yield two independent rows", () => {
  const rowA = { ...swaggerPositionRow, positionId: 100, volume: 0.01 }
  const rowB = { ...swaggerPositionRow, positionId: 101, volume: 0.02 }
  const tradeA = mapPositionHistoryRow(rowA, broker)
  const tradeB = mapPositionHistoryRow(rowB, broker)
  assertNotEquals(tradeA, null)
  assertNotEquals(tradeB, null)
  assertEquals(tradeA!.ticket, 100)
  assertEquals(tradeB!.ticket, 101)
  assertEquals(tradeA!.lot_size, 0.01)
  assertEquals(tradeB!.lot_size, 0.02)
})

Deno.test("mapPositionHistoryRow: unix closeTime seconds", () => {
  const row = {
    ...swaggerPositionRow,
    closeTime: 1_749_459_184,
    openTime: 1_749_458_157,
  }
  const trade = mapPositionHistoryRow(row, broker)
  assertNotEquals(trade, null)
  assertEquals(trade!.closed_at, new Date(1_749_459_184_000).toISOString())
})

Deno.test("mapPositionHistoryRow: missing closeTime skips row", () => {
  const { closeTime: _omit, ...withoutClose } = swaggerPositionRow
  const trade = mapPositionHistoryRow(withoutClose, broker)
  assertEquals(trade, null)
})

Deno.test("mapPositionHistoryRow: closed_at parses to displayable time", () => {
  const trade = mapPositionHistoryRow(swaggerPositionRow, broker)
  assertNotEquals(trade, null)
  const ms = Date.parse(trade!.closed_at!)
  assertEquals(Number.isFinite(ms), true)
  const label = new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  assertNotEquals(label.trim(), "")
})

// ── MTAPI OrderHistory source (captured bridge row) ───────────────────────

const mtapiClosedOrder = {
  ticket: 3276777659,
  lots: 0.01,
  closeLots: 0.01,
  volume: 1000000,
  closeVolume: 1000000,
  openPrice: 4264.219,
  closePrice: 4276,
  openTime: "2026-09-24T11:30:12.178",
  closeTime: "2026-09-24T12:50:16.778",
  openTimestampUTC: 1790249412178,
  closeTimestampUTC: 1790254216778,
  orderType: "Sell",
  dealType: "DealSell",
  state: "Filled",
  symbol: "XAUUSDm",
  profit: -11.78,
  swap: 0,
  commission: 0,
  stopLoss: 4300,
  takeProfit: 4200,
  comment: "TScopier:ch:4354ff31",
  dealInternalIn: {
    ticket: 3276777650,
    lots: 0.01,
    volume: 1000000,
    type: "DealSell",
    direction: "In",
    openTime: "2026-09-24T11:30:12.178",
  },
  dealInternalOut: {
    ticket: 3276777659,
    lots: 0.01,
    volume: 1000000,
    type: "DealBuy",
    direction: "Out",
    closeTime: "2026-09-24T12:50:16.778",
    profit: -11.78,
  },
}

const mtapiOpenOrder = {
  ticket: 3290000001,
  lots: 0.01,
  closeLots: 0,
  volume: 1000000,
  closeVolume: 0,
  openPrice: 4264.219,
  openTime: "2026-09-25T09:00:00.000",
  openTimestampUTC: 1790300000000,
  closeTime: "0001-01-01T00:00:00",
  closeTimestampUTC: 0,
  orderType: "Sell",
  dealType: "DealSell",
  state: "Filled",
  symbol: "XAUUSDm",
  profit: 0,
  stopLoss: 4300,
  takeProfit: 4200,
  comment: "",
  dealInternalIn: {
    ticket: 3290000000,
    lots: 0.01,
    volume: 1000000,
    type: "DealSell",
    direction: "In",
    openTime: "2026-09-25T09:00:00.000",
  },
}

const tradesOpts = {
  scope: "all",
  historyFrom: "2000-01-01T00:00:00",
  historyTo: "2026-09-25T12:00:00",
  historyProfile: "trades",
  limit: 0,
  includeBalanceCashFlow: false,
} as const

Deno.test("fetchFxsocketBrokerTrades: MTAPI source reads closed rows from OrderHistory", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [mtapiOpenOrder],
    orderHistory: async () => [mtapiClosedOrder],
    positionHistory: async () => {
      throw new Error("ORDER_HISTORY_NOT_READY")
    },
    closedHistorySource: "order_history",
  }

  const trades = await fetchFxsocketBrokerTrades(source, sessionBroker, tradesOpts)
  assertEquals(trades.length, 2)

  const open = trades.find(t => t.status === "open")
  const closed = trades.find(t => t.status === "closed")
  assertNotEquals(open, undefined)
  assertNotEquals(closed, undefined)

  // Zero-shadow fix: closeLots/closeVolume 0 must not mask lots 0.01.
  assertEquals(open!.lot_size, 0.01)
  assertEquals(open!.symbol, "XAUUSDm")

  assertEquals(closed!.ticket, 3276777659)
  assertEquals(closed!.lot_size, 0.01)
  assertEquals(closed!.symbol, "XAUUSDm")
  // OUT deal on a sell position reads Buy — direction must stay the side of the entry.
  assertEquals(closed!.direction, "sell")
  assertEquals(closed!.profit, -11.78)
  assertEquals(closed!.entry_price, 4264.219)
  assertEquals(
    closed!.closed_at,
    new Date(Date.parse("2026-09-24T12:50:16.778")).toISOString(),
  )
})

Deno.test("fetchFxsocketBrokerTrades: default source keeps PositionHistory closed rows", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [],
    orderHistory: async () => {
      throw new Error("OrderHistory must not be used without closedHistorySource")
    },
    positionHistory: async () => [swaggerPositionRow],
  }

  const trades = await fetchFxsocketBrokerTrades(source, sessionBroker, tradesOpts)
  assertEquals(trades.length, 1)
  assertEquals(trades[0].ticket, 1679874108)
  assertEquals(trades[0].direction, "sell")
  assertEquals(trades[0].lot_size, 0.01)
})

Deno.test("fetchTradesListFromOrderHistory: open orders and balance rows are skipped", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [],
    orderHistory: async () => [
      // Open order echoed by the history feed (close time at epoch start).
      { ...mtapiOpenOrder, ticket: 3290000002 },
      // Balance-style row: no symbol, no size — never a trade row.
      {
        ticket: 777,
        symbol: "",
        lots: 0,
        volume: 0,
        closeLots: 0,
        closeTime: "2026-09-24T08:00:00.000",
        type: "Balance",
        profit: 500,
      },
      mtapiClosedOrder,
    ],
    positionHistory: async () => {
      throw new Error("not used")
    },
    closedHistorySource: "order_history",
  }

  const rows = await fetchTradesListFromOrderHistory(source, sessionBroker, {
    historyFrom: tradesOpts.historyFrom,
    historyTo: tradesOpts.historyTo,
  })
  assertEquals(rows.length, 1)
  assertEquals(rows[0].ticket, 3276777659)
})

Deno.test("fetchTradesListFromOrderHistory: cancelled pending orders are skipped", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [],
    orderHistory: async () => [
      // Cancelled pending: real close time, size, and symbol — but never a trade.
      {
        ...mtapiClosedOrder,
        ticket: 3290000099,
        state: "Cancelled",
        profit: 0,
      },
      // The other documented executed state must be kept.
      { ...mtapiClosedOrder, ticket: 3290000100, state: "Started" },
      mtapiClosedOrder,
    ],
    positionHistory: async () => {
      throw new Error("not used")
    },
    closedHistorySource: "order_history",
  }

  const rows = await fetchTradesListFromOrderHistory(source, sessionBroker, {
    historyFrom: tradesOpts.historyFrom,
    historyTo: tradesOpts.historyTo,
  })
  assertEquals(rows.length, 2)
  assertEquals(rows.map(r => r.ticket).sort((a, b) => a - b), [3276777659, 3290000100])
})

Deno.test("fetchFxsocketBrokerTrades: all rejected closed requests throw", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [mtapiOpenOrder],
    orderHistory: async () => {
      throw new Error("ORDER_HISTORY_NOT_READY")
    },
    positionHistory: async () => {
      throw new Error("ORDER_HISTORY_NOT_READY")
    },
    closedHistorySource: "order_history",
  }

  await assertRejects(
    () => fetchFxsocketBrokerTrades(source, sessionBroker, { ...tradesOpts, scope: "closed" }),
    Error,
    "ORDER_HISTORY_NOT_READY",
  )
})

Deno.test("fetchFxsocketBrokerTrades: default source throws when history fails", async () => {
  const source: MtHistorySource = {
    openedOrders: async () => [],
    orderHistory: async () => {
      throw new Error("not used")
    },
    positionHistory: async () => {
      throw new Error("ORDER_HISTORY_NOT_READY")
    },
  }

  await assertRejects(
    () => fetchFxsocketBrokerTrades(source, sessionBroker, { ...tradesOpts, scope: "closed" }),
    Error,
    "ORDER_HISTORY_NOT_READY",
  )
})

// ── Bounded history-chunk concurrency (2026-11-25 bridge-stall fix) ────────

Deno.test("allSettledBounded: never exceeds the concurrency limit", async () => {
  let inFlight = 0
  let peak = 0
  const items = Array.from({ length: 40 }, (_, i) => i)
  const results = await allSettledBounded(items, 4, async () => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise(resolve => setTimeout(resolve, 2))
    inFlight -= 1
    return "ok"
  })
  assertEquals(peak, 4)
  assertEquals(results.length, 40)
  assertEquals(results.every(r => r.status === "fulfilled"), true)
})

Deno.test("allSettledBounded: results keep input order and rejection shape", async () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7]
  const results = await allSettledBounded(items, 3, async (i) => {
    await new Promise(resolve => setTimeout(resolve, (7 - i) % 3))
    if (i === 3) throw new Error("boom-3")
    return i * 2
  })
  assertEquals(results.length, 8)
  assertEquals(results[0], { status: "fulfilled", value: 0 })
  assertEquals(results[2], { status: "fulfilled", value: 4 })
  assertEquals(results[3]!.status, "rejected")
  if (results[3]!.status === "rejected") {
    assertEquals((results[3]!.reason as Error).message, "boom-3")
  }
  assertEquals(results[7], { status: "fulfilled", value: 14 })
})

Deno.test("allSettledBounded: limit larger than input runs everything", async () => {
  const results = await allSettledBounded([1, 2], 50, (i) => Promise.resolve(i))
  assertEquals(results, [
    { status: "fulfilled", value: 1 },
    { status: "fulfilled", value: 2 },
  ])
})

Deno.test("allSettledBounded: empty input resolves to empty results", async () => {
  const results = await allSettledBounded([], 4, () => Promise.resolve("never"))
  assertEquals(results, [])
})

/**
 * A 26-year full-history read (the shape that stalled the bridge) must never
 * have more than HISTORY_CHUNK_CONCURRENCY chunk requests in flight, and must
 * still merge every chunk's rows.
 */
Deno.test("fetchClosedHistoryForBaseline: full-history read is bounded to HISTORY_CHUNK_CONCURRENCY in flight", async () => {
  let inFlight = 0
  let peak = 0
  let calls = 0
  const source: MtHistorySource = {
    openedOrders: () => Promise.resolve([]),
    orderHistory: async () => {
      const chunkNo = (calls += 1)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 2))
      inFlight -= 1
      // Unique ticket per chunk so the merge cannot dedupe rows away.
      return [{ ...mtapiClosedOrder, ticket: 3276777659 + chunkNo }]
    },
    positionHistory: () => Promise.resolve([]),
    closedHistorySource: "order_history",
  }
  const rows = await fetchClosedHistoryForBaseline(source, sessionBroker, {
    historyFrom: "2000-01-01T00:00:00",
    historyTo: "2026-11-25T00:00:00",
    historyProfile: "trades",
  })
  // 26 years / 45-day chunks ≈ 211 chunks — the old code fired all at once.
  assertEquals(calls > 100, true, `expected >100 chunks, got ${calls}`)
  assertEquals(peak <= HISTORY_CHUNK_CONCURRENCY, true, `peak in-flight was ${peak}`)
  assertEquals(rows.length, calls, "every chunk's row must survive the merge")
})

Deno.test("allSettledBounded: non-finite limits still process every item (no undefined holes)", async () => {
  for (const limit of [NaN, Infinity, -Infinity]) {
    const results = await allSettledBounded([1, 2, 3], limit, (i) => Promise.resolve(i * 2))
    assertEquals(results.length, 3, `limit=${limit}`)
    assertEquals(results[2], { status: "fulfilled", value: 6 }, `limit=${limit}`)
    assertEquals(results.every(r => r !== undefined), true, `limit=${limit} produced a hole`)
  }
})
