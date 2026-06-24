/**
 * Management latency benchmark (offline, no live broker).
 *
 * Drives the REAL management apply primitives against a mock FxSocket bridge
 * with a fixed per-call round-trip latency, so the measured wall time reflects
 * the actual call structure (serial vs parallel, number of broker round-trips).
 *
 * Run from worker/:
 *   node --require ts-node/register scripts/mgmtLatencyBench.ts
 *   BENCH_RTT_MS=300 BENCH_LEGS=32 node --require ts-node/register scripts/mgmtLatencyBench.ts
 *
 * Env:
 *   BENCH_RTT_MS  simulated broker round-trip per call (default 250)
 *   BENCH_LEGS    legs in the basket (default 32)
 *   MGMT_LEG_CONCURRENCY  parallel leg cap (default 8)
 */
process.env.FXSOCKET_API_KEY = process.env.FXSOCKET_API_KEY ?? 'bench'

import { applyChannelStopsToBaskets, type ChannelStopBroker, type ChannelStopLeg } from '../src/channelStopApply'
import { runBasketLegModifies, type BasketOpenLeg, type BasketSymbolParams } from '../src/basketSlTpReconcile'

const RTT = Math.max(0, Number(process.env.BENCH_RTT_MS ?? 250))
const LEGS = Math.max(1, Number(process.env.BENCH_LEGS ?? 32))
const UUID = '11111111-1111-1111-1111-111111111111'
const SYMBOL = 'XAUUSD'
const ENTRY = 4150
const NEW_SL = 4100 // valid (below entry) for a buy

const SYMBOL_PARAMS: BasketSymbolParams = {
  digits: 2, point: 0.01, minLot: 0.01, lotStep: 0.01, contractSize: 100, stopsLevel: 0, freezeLevel: 0,
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeApi(tickets: number[]) {
  const calls = { openedOrders: 0, quote: 0, orderModify: 0, symbolParams: 0 }
  const api = {
    calls,
    seedPlatformCache() {},
    async openedOrders() { calls.openedOrders++; await sleep(RTT); return tickets.map(t => ({ ticket: t })) },
    async quote() { calls.quote++; await sleep(RTT); return { bid: ENTRY, ask: ENTRY + 0.2, symbol: SYMBOL } },
    async orderModify(_uuid: string, a: { stoploss?: number; takeprofit?: number }) {
      calls.orderModify++; await sleep(RTT); return { stopLoss: a.stoploss, takeProfit: a.takeprofit }
    },
    async symbolParams() { calls.symbolParams++; await sleep(RTT); return SYMBOL_PARAMS },
  }
  return api
}

// Fast no-op Supabase: every chain resolves immediately.
function makeSupabase() {
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    const self = () => b
    b.insert = () => Promise.resolve({ data: null, error: null })
    b.update = self
    b.upsert = () => Promise.resolve({ data: { id: 'job' }, error: null })
    b.delete = self
    b.select = self
    b.eq = self; b.in = self; b.lte = self; b.lt = self; b.gte = self
    b.not = self; b.ilike = self; b.order = self; b.limit = self
    b.maybeSingle = () => Promise.resolve({ data: null, error: null })
    b.single = () => Promise.resolve({ data: { id: 'job' }, error: null })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res)
    return b
  }
  return { from: () => builder() }
}

const tickets = Array.from({ length: LEGS }, (_, i) => 1000 + i)

function channelStopLegs(): ChannelStopLeg[] {
  return tickets.map((t, i) => ({
    id: `t${t}`,
    signal_id: 'anchor',
    broker_account_id: 'b1',
    metaapi_order_id: String(t),
    symbol: SYMBOL,
    direction: 'buy',
    sl: null,
    tp: null,
    opened_at: `2026-06-20T10:00:${String(i % 60).padStart(2, '0')}Z`,
    entry_price: ENTRY,
    telegram_channel_id: 'ch-1',
  }))
}

function basketLegs(): BasketOpenLeg[] {
  return tickets.map((t, i) => ({
    id: `t${t}`,
    signal_id: 'anchor',
    metaapi_order_id: String(t),
    opened_at: `2026-06-20T10:00:${String(i % 60).padStart(2, '0')}Z`,
    lot_size: 0.05,
    sl: null,
    tp: null,
    entry_price: ENTRY,
    direction: 'buy',
    symbol: SYMBOL,
  }))
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now()
  const result = await fn()
  return { ms: Math.round(performance.now() - t0), result }
}

async function benchChannelStopApply() {
  const api = makeApi(tickets)
  const broker: ChannelStopBroker = { id: 'b1', platform: 'mt5', fxsocket_account_id: UUID, manual_settings: { tp_lots: null } }
  const { ms } = await timed(() => applyChannelStopsToBaskets({
    supabase: makeSupabase() as never,
    apiFor: () => api as never,
    userId: 'u', channelId: 'ch-1', signalId: 'mod-1',
    brokersById: new Map([['b1', broker]]),
    rowsByBrokerSignal: new Map([['b1|anchor', channelStopLegs()]]),
    hasNewSl: true, hasNewTp: false, parsedSl: NEW_SL, parsedTpLevels: [], verifyOnBroker: false,
  }))
  return { ms, calls: api.calls }
}

async function benchRunBasketLegModifies(opts: { parallel: boolean; sharedQuote: boolean }) {
  const api = makeApi(tickets)
  const prefetch = opts.sharedQuote ? { bid: ENTRY, ask: ENTRY + 0.2 } : null
  const { ms } = await timed(() => runBasketLegModifies({
    supabase: makeSupabase() as never,
    api: api as never,
    uuid: UUID, symbol: SYMBOL, direction: 'buy', baseLot: 0.05, params: SYMBOL_PARAMS,
    signalId: 'mod-1', userId: 'u', brokerAccountId: 'b1',
    familyTrades: basketLegs(),
    perLegTargets: tickets.map(() => ({ stoploss: NEW_SL, takeprofit: 4265 })),
    nImmCwe: 0, overrideTp: null,
    strictEntryPrefetch: prefetch,
    openedTickets: new Set(tickets),
    explicitChannelTargets: true,
    parallelLegs: opts.parallel,
  }))
  return { ms, calls: api.calls }
}

async function main() {
  console.log(`mgmt latency bench: legs=${LEGS} rtt=${RTT}ms concurrency=${process.env.MGMT_LEG_CONCURRENCY ?? 8}\n`)

  const rows: Array<{ scenario: string; wall_ms: number; openedOrders: number; quote: number; orderModify: number }> = []

  const cs = await benchChannelStopApply()
  rows.push({ scenario: 'modify: applyChannelStopsToBaskets (current)', wall_ms: cs.ms, openedOrders: cs.calls.openedOrders, quote: cs.calls.quote, orderModify: cs.calls.orderModify })

  const serialPerLegQuote = await benchRunBasketLegModifies({ parallel: false, sharedQuote: false })
  rows.push({ scenario: 'rebalance: serial + per-leg quote (old)', wall_ms: serialPerLegQuote.ms, openedOrders: serialPerLegQuote.calls.openedOrders, quote: serialPerLegQuote.calls.quote, orderModify: serialPerLegQuote.calls.orderModify })

  const parallelSharedQuote = await benchRunBasketLegModifies({ parallel: true, sharedQuote: true })
  rows.push({ scenario: 'rebalance: parallel + shared quote (current)', wall_ms: parallelSharedQuote.ms, openedOrders: parallelSharedQuote.calls.openedOrders, quote: parallelSharedQuote.calls.quote, orderModify: parallelSharedQuote.calls.orderModify })

  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(pad('scenario', 46), pad('wall_ms', 9), pad('openedOrders', 13), pad('quote', 7), 'orderModify')
  for (const r of rows) {
    console.log(pad(r.scenario, 46), pad(String(r.wall_ms), 9), pad(String(r.openedOrders), 13), pad(String(r.quote), 7), r.orderModify)
  }
  console.log(`\nTheoretical floor (1 wave of orderModify at concurrency): ~${RTT}ms + snapshot ${RTT}ms = ~${2 * RTT}ms`)
}

main().catch(err => { console.error(err); process.exit(1) })
