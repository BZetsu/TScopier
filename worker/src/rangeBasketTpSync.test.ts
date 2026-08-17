import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  initWorkerSentry,
  resetWorkerSentryForTests,
  setSentryAdapterForTests,
} from './observability/sentry'
import { resetBusinessEventsForTests } from './observability/businessEvents'
import {
  backfillNakedLegTakeProfits,
  buildRangeBasketTpTargets,
  classifyBasketTpSyncLegFailure,
  coercePositiveTpLevels,
  deepestFinalTp,
  estimatePlanImmediateLegCount,
  fillZeroTargetsWithDeepest,
  preserveOpenLegTakeProfits,
  pickV2MergeDistributeTargets,
  applyOpenLegStopLossToTargets,
  resolveFiringLegStops,
  resolveRangeBasketFinalTps,
  resolveRangeBasketLegCounts,
  resolveRangeTpRebalanceGate,
  rangeBasketTpRebalanceStatus,
  syncRangeBasketTakeProfits,
} from './rangeBasketTpSync'
import type { BasketOpenLeg } from './basketSlTpReconcile'
import type { FxsocketBrokerClient } from './fxsocketClient'

type LogRow = {
  user_id: string
  signal_id: string
  broker_account_id: string
  action: string
  status: string
  request_payload: Record<string, unknown>
}

function fakeSupabaseForRebalance(
  trades: BasketOpenLeg[],
  captured: LogRow[],
  tables: Record<string, unknown[]> = {},
) {
  const all: Record<string, unknown[]> = {
    trades,
    range_pending_legs: [],
    basket_sl_tp_targets: [],
    channel_active_trade_params: [],
    signals: [{ parsed_data: { sl: 4376, tp: [] } }],
    ...tables,
  }
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = self
    b.eq = self
    b.in = self
    b.gte = self
    b.order = self
    b.limit = () => Promise.resolve({ data: all[table] ?? [], error: null })
    b.maybeSingle = () =>
      Promise.resolve({ data: (all[table] ?? [])[0] ?? null, error: null })
    b.insert = (row: unknown) => {
      captured.push(row as LogRow)
      return Promise.resolve({ data: null, error: null })
    }
    b.update = () => ({
      eq: () => Promise.resolve({ data: [], error: null }),
    })
    return b
  }
  return { from: (t: string) => builder(t) }
}

const stubApi = {
  quote: async () => ({ bid: 4390, ask: 4391 }),
} as unknown as FxsocketBrokerClient

class MockScope {
  level: string | null = null
  tags: Record<string, string> = {}
  contexts: Record<string, unknown> = {}
  fingerprint: string[] | null = null
  setLevel(level: string): void { this.level = level }
  setTag(key: string, value: string): void { this.tags[key] = value }
  setContext(key: string, value: unknown): void { this.contexts[key] = value }
  setFingerprint(value: string[]): void { this.fingerprint = value }
}

function mockSentry() {
  const mock = {
    initCalls: [] as unknown[],
    capturedMessages: [] as unknown[],
    scopes: [] as MockScope[],
    tags: {} as Record<string, string>,
    contexts: {} as Record<string, unknown>,
    init(opts: unknown) { mock.initCalls.push(opts) },
    captureException() { return 'event-id' },
    captureMessage(msg: string, level?: string) {
      mock.capturedMessages.push({ msg, level })
      return 'event-id'
    },
    addBreadcrumb() {},
    setTag(key: string, value: string) { mock.tags[key] = value },
    setContext(key: string, value: unknown) { mock.contexts[key] = value },
    withScope(fn: (scope: MockScope) => void) {
      const scope = new MockScope()
      mock.scopes.push(scope)
      fn(scope)
    },
    async flush() { return true },
  }
  return mock
}

function setupSentry() {
  resetWorkerSentryForTests()
  resetBusinessEventsForTests()
  const mock = mockSentry()
  setSentryAdapterForTests(mock as never)
  initWorkerSentry({
    SENTRY_ENABLED: 'true',
    SENTRY_DSN: 'https://public@example.invalid/1',
    SENTRY_BUSINESS_EVENT_COOLDOWN_MS: '0',
  } as NodeJS.ProcessEnv)
  return mock
}

const TP_LOTS = [
  { label: 'TP1', lot: 0, percent: 50, enabled: true },
  { label: 'TP2', lot: 0, percent: 30, enabled: true },
  { label: 'TP3', lot: 0, percent: 20, enabled: true },
]

function openLeg(id: string, entry: number, openedAt: string): BasketOpenLeg {
  return {
    id,
    signal_id: 'sig',
    metaapi_order_id: '1',
    opened_at: openedAt,
    lot_size: 0.01,
    sl: 4300,
    tp: 4530,
    entry_price: entry,
    direction: 'buy',
    symbol: 'XAUUSD',
  }
}

function rangeSyncLeg(id: string, ticket: number, entry: number): BasketOpenLeg {
  return {
    ...openLeg(id, entry, `2026-01-01T00:00:0${ticket % 10}Z`),
    metaapi_order_id: String(ticket),
    sl: 4376,
    tp: 0,
  }
}

function apiForModifyPlan(plan: Record<number, Array<'ok' | 'timeout'>>) {
  const calls: Array<{ ticket: number; stoploss?: number; takeprofit?: number }> = []
  return {
    calls,
    quote: async () => ({ bid: 4390, ask: 4391, symbol: 'XAUUSD' }),
    openedOrders: async () =>
      Object.keys(plan).map(ticket => ({ ticket: Number(ticket) })),
    orderModify: async (_uuid: string, args: { ticket: number; stoploss?: number; takeprofit?: number }) => {
      calls.push(args)
      const steps = plan[args.ticket] ?? ['ok']
      const next = steps.shift() ?? 'ok'
      if (next === 'timeout') throw new Error('TradingHelper.OrderModify timed out')
      return { stopLoss: args.stoploss ?? null, takeProfit: args.takeprofit ?? null }
    },
  }
}

async function runRangeSyncScenario(
  family: BasketOpenLeg[],
  api: ReturnType<typeof apiForModifyPlan>,
): Promise<ReturnType<typeof mockSentry>> {
  process.env.RANGE_REBALANCE_RETRY_DELAY_MS = '0'
  const mock = setupSentry()
  const captured: LogRow[] = []
  const supabase = fakeSupabaseForRebalance(family, captured)
  await syncRangeBasketTakeProfits({
    supabase: supabase as never,
    api: api as never,
    uuid: 'uuid',
    symbol: 'XAUUSD',
    direction: 'buy',
    baseLot: 0.05,
    params: null,
    signalId: 'sig-range',
    userId: 'user-range',
    brokerAccountId: 'broker-range',
    manual: { range_trading: true },
    parsed: { sl: 4376, tp: [4410, 4420, 4430] },
    forceLayeringRebalance: true,
  })
  return mock
}

function capturedBasketFailureExtra(mock: ReturnType<typeof mockSentry>): Record<string, unknown> {
  const scope = mock.scopes.find(s => s.tags.event_name === 'basket_tp_sync_failed')
  assert.ok(scope, 'basket_tp_sync_failed should be captured')
  const context = scope.contexts.pipeline as { extra?: Record<string, unknown> }
  assert.ok(context.extra, 'pipeline extra context should be present')
  return context.extra!
}

test('resolveRangeBasketLegCounts: phase B after first range leg', () => {
  const counts = resolveRangeBasketLegCounts({
    openLegCount: 11,
    planImmediateLegCount: 10,
    activePendingCount: 9,
    maxPendingStepIdx: 10,
  })
  assert.equal(counts.firedRangeLegCount, 1)
  assert.equal(counts.phase, 'layering_rebalance')
})

test('buildRangeBasketTpTargets: phase A uses instant pool only', () => {
  const legs = Array.from({ length: 4 }, (_, i) =>
    openLeg(`i${i}`, 4335, `2026-01-01T00:00:0${i}Z`),
  )
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4300, tp: [4530, 4510, 4490] },
    tpLots: TP_LOTS,
    direction: 'buy',
    activePendingCount: 10,
    maxPendingStepIdx: 10,
  })
  assert.equal(targets.filter(t => t.takeprofit === 4530).length, 2)
})

test('estimatePlanImmediateLegCount: infers instants after all range legs fired', () => {
  assert.equal(
    estimatePlanImmediateLegCount({
      openLegCount: 27,
      activePendingCount: 0,
      maxPendingStepIdx: 10,
    }),
    17,
  )
})

test('resolveRangeBasketLegCounts: layering phase when all pending fired', () => {
  const counts = resolveRangeBasketLegCounts({
    openLegCount: 27,
    planImmediateLegCount: 17,
    activePendingCount: 0,
    maxPendingStepIdx: 10,
  })
  assert.equal(counts.firedRangeLegCount, 10)
  assert.equal(counts.phase, 'layering_rebalance')
})

test('coercePositiveTpLevels: accepts numeric strings', () => {
  assert.deepEqual(coercePositiveTpLevels(['4345', 4355, '4360']), [4345, 4355, 4360])
})

test('resolveRangeBasketFinalTps: falls back to open-leg ladder when multiple TP levels', () => {
  const legs = [
    openLeg('a', 4335, '2026-01-01T00:00:00Z'),
    openLeg('b', 4336, '2026-01-01T00:00:01Z'),
  ]
  legs[0]!.tp = 4345
  legs[1]!.tp = 4360
  const tps = resolveRangeBasketFinalTps({
    parsed: {},
    plan: null,
    familyTrades: legs,
    direction: 'buy',
  })
  assert.deepEqual(tps, [4345, 4360])
})

test('resolveRangeBasketFinalTps: ignores single TP on many legs (failed balance)', () => {
  const legs = Array.from({ length: 5 }, (_, i) =>
    openLeg(`i${i}`, 4335, `2026-01-01T00:00:0${i}Z`),
  )
  for (const leg of legs) leg.tp = 4332
  const tps = resolveRangeBasketFinalTps({
    parsed: {},
    plan: null,
    familyTrades: legs,
    direction: 'buy',
  })
  assert.deepEqual(tps, [])
})

test('resolveRangeBasketFinalTps: prefers channel ladder over single open-leg TP', () => {
  const legs = Array.from({ length: 5 }, (_, i) =>
    openLeg(`i${i}`, 4335, `2026-01-01T00:00:0${i}Z`),
  )
  for (const leg of legs) leg.tp = 4332
  const tps = resolveRangeBasketFinalTps({
    parsed: {},
    plan: null,
    familyTrades: legs,
    channelTpLevels: [4332, 4334, 4336],
    direction: 'buy',
  })
  assert.deepEqual(tps, [4332, 4334, 4336])
})

test('buildRangeBasketTpTargets: stoplossOverride wins over anchor parsed.sl', () => {
  const legs = [
    { ...openLeg('a', 4255, '2026-01-01T00:00:00Z'), sl: null },
    { ...openLeg('b', 4252, '2026-01-01T00:00:01Z'), sl: null },
  ]
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4245, tp: [4265, 4275] },
    tpLots: TP_LOTS,
    direction: 'buy',
    activePendingCount: 0,
    maxPendingStepIdx: 0,
    stoplossOverride: 4242,
  })
  assert.equal(targets.length, 2)
  assert.ok(targets.every(t => t.stoploss === 4242))
})

test('buildRangeBasketTpTargets: coerced string TPs produce non-zero phase B targets', () => {
  const legs = Array.from({ length: 4 }, (_, i) =>
    openLeg(`i${i}`, 4335 - i * 0.1, `2026-01-01T00:00:0${i}Z`),
  )
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4300, tp: ['4345', '4355', '4360'] },
    tpLots: TP_LOTS,
    direction: 'buy',
    activePendingCount: 9,
    maxPendingStepIdx: 10,
    forceLayeringRebalance: true,
  })
  assert.equal(targets.length, 4)
  assert.ok(targets.every(t => t.takeprofit > 0))
  assert.ok(targets.some(t => t.takeprofit === 4345))
  assert.ok(targets.some(t => t.takeprofit === 4360))
})

test('resolveRangeTpRebalanceGate: allows instant_only and force layering', () => {
  assert.equal(
    resolveRangeTpRebalanceGate({
      activePendingCount: 5,
      maxPendingStepIdx: 10,
      phase: 'instant_only',
      hasClosedBasketLegs: false,
    }).allowOpenLegTpModify,
    true,
  )
  assert.equal(
    resolveRangeTpRebalanceGate({
      activePendingCount: 0,
      maxPendingStepIdx: 10,
      phase: 'layering_rebalance',
      forceLayeringRebalance: true,
      hasClosedBasketLegs: false,
    }).allowOpenLegTpModify,
    true,
  )
})

test('resolveRangeTpRebalanceGate: denies when layering complete or leg closed', () => {
  assert.equal(
    resolveRangeTpRebalanceGate({
      activePendingCount: 0,
      maxPendingStepIdx: 10,
      phase: 'layering_rebalance',
      hasClosedBasketLegs: false,
    }).allowOpenLegTpModify,
    false,
  )
  assert.equal(
    resolveRangeTpRebalanceGate({
      activePendingCount: 3,
      maxPendingStepIdx: 10,
      phase: 'layering_rebalance',
      hasClosedBasketLegs: true,
    }).reason,
    'basket_leg_closed',
  )
})

test('resolveRangeTpRebalanceGate: sticky TP touch freezes even under forceLayeringRebalance', () => {
  const gate = resolveRangeTpRebalanceGate({
    activePendingCount: 5,
    maxPendingStepIdx: 10,
    phase: 'layering_rebalance',
    forceLayeringRebalance: true,
    hasClosedBasketLegs: false,
    tpTouched: true,
  })
  assert.equal(gate.mode, 'backfill_only')
  assert.equal(gate.allowOpenLegTpModify, false)
  assert.equal(gate.reason, 'tp_touched')
})

test('resolveRangeTpRebalanceGate: redistributes while layering before any TP hit', () => {
  const gate = resolveRangeTpRebalanceGate({
    activePendingCount: 5,
    maxPendingStepIdx: 10,
    phase: 'layering_rebalance',
    forceLayeringRebalance: true,
    hasClosedBasketLegs: false,
    tpTouched: false,
  })
  assert.equal(gate.mode, 'redistribute')
  assert.equal(gate.allowOpenLegTpModify, true)
})

test('resolveRangeTpRebalanceGate: message revision bypasses closed legs and tp touch freeze', () => {
  const gate = resolveRangeTpRebalanceGate({
    activePendingCount: 0,
    maxPendingStepIdx: 10,
    phase: 'layering_rebalance',
    forceLayeringRebalance: false,
    forceMessageRevisionRefresh: true,
    hasClosedBasketLegs: true,
    tpTouched: true,
  })
  assert.equal(gate.mode, 'redistribute')
  assert.equal(gate.allowOpenLegTpModify, true)
  assert.equal(gate.reason, 'message_revision_refresh')
})

test('deepestFinalTp: buy uses max, sell uses min', () => {
  assert.equal(deepestFinalTp([4530, 4510, 4490], true), 4530)
  assert.equal(deepestFinalTp([4530, 4510, 4490], false), 4490)
  assert.equal(deepestFinalTp([], true), 0)
})

test('backfillNakedLegTakeProfits: assigns deepest TP to naked legs, never repaints others', () => {
  const legs = [
    { ...openLeg('a', 4335, '2026-01-01T00:00:00Z'), tp: 4490 },
    { ...openLeg('b', 4330, '2026-01-01T00:00:01Z'), tp: 0 },
    { ...openLeg('c', 4325, '2026-01-01T00:00:02Z'), tp: null as unknown as number },
  ]
  const out = backfillNakedLegTakeProfits(
    legs,
    [
      { stoploss: 4300, takeprofit: 9999 },
      { stoploss: 4300, takeprofit: 9999 },
      { stoploss: 4300, takeprofit: 9999 },
    ],
    [4530, 4510, 4490],
    true,
  )
  assert.equal(out[0]!.takeprofit, 4490, 'existing TP preserved, not repainted')
  assert.equal(out[1]!.takeprofit, 4530, 'naked leg gets deepest TP (buy=max)')
  assert.equal(out[2]!.takeprofit, 4530, 'null TP leg gets deepest TP')
})

test('fillZeroTargetsWithDeepest: only fills zero targets', () => {
  const out = fillZeroTargetsWithDeepest(
    [
      { stoploss: 4300, takeprofit: 4490 },
      { stoploss: 4300, takeprofit: 0 },
    ],
    [4530, 4510, 4490],
    true,
  )
  assert.equal(out[0]!.takeprofit, 4490)
  assert.equal(out[1]!.takeprofit, 4530)
})

test('every layering leg ends with SL and TP (Fix 1: no SL-only legs)', () => {
  const legs = Array.from({ length: 9 }, (_, i) =>
    openLeg(`i${i}`, 4335 - i * 0.1, `2026-01-01T00:00:0${i}Z`),
  )
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4300, tp: [4530, 4510, 4490] },
    tpLots: TP_LOTS,
    direction: 'buy',
    activePendingCount: 3,
    maxPendingStepIdx: 10,
    forceLayeringRebalance: true,
  })
  const filled = fillZeroTargetsWithDeepest(targets, [4530, 4510, 4490], true)
  assert.equal(filled.length, 9)
  assert.ok(filled.every(t => t.stoploss > 0), 'all legs have SL')
  assert.ok(filled.every(t => t.takeprofit > 0), 'all legs have TP')
})

test('resolveFiringLegStops: latest effective SL overrides a stale leg SL', () => {
  const out = resolveFiringLegStops({
    legStoploss: 4100,
    legTakeprofit: 4490,
    cweClosePrice: null,
    effective: { stoploss: 4155, tpLevels: [4530, 4510, 4490] },
    isBuy: true,
  })
  assert.equal(out.stoploss, 4155)
  assert.equal(out.takeprofit, 4490, 'existing TP preserved, not repainted')
})

test('resolveFiringLegStops: naked leg gets deepest TP (buy=max), keeps effective SL', () => {
  const out = resolveFiringLegStops({
    legStoploss: 0,
    legTakeprofit: 0,
    cweClosePrice: null,
    effective: { stoploss: 4155, tpLevels: [4530, 4510, 4490] },
    isBuy: true,
  })
  assert.equal(out.stoploss, 4155)
  assert.equal(out.takeprofit, 4530)
})

test('resolveFiringLegStops: sell naked leg gets deepest TP (min)', () => {
  const out = resolveFiringLegStops({
    legStoploss: null,
    legTakeprofit: null,
    cweClosePrice: null,
    effective: { stoploss: 4180, tpLevels: [4150, 4140, 4130] },
    isBuy: false,
  })
  assert.equal(out.stoploss, 4180)
  assert.equal(out.takeprofit, 4130)
})

test('resolveFiringLegStops: CWE leg rides with no TP', () => {
  const out = resolveFiringLegStops({
    legStoploss: 4100,
    legTakeprofit: 4490,
    cweClosePrice: 4200,
    effective: { stoploss: 4155, tpLevels: [4530] },
    isBuy: true,
  })
  assert.equal(out.stoploss, 4155)
  assert.equal(out.takeprofit, 0)
})

test('resolveFiringLegStops: falls back to leg SL when effective SL is missing', () => {
  const out = resolveFiringLegStops({
    legStoploss: 4100,
    legTakeprofit: 0,
    cweClosePrice: null,
    effective: { stoploss: 0, tpLevels: [] },
    isBuy: true,
  })
  assert.equal(out.stoploss, 4100)
  assert.equal(out.takeprofit, 0)
})

test('preserveOpenLegTakeProfits keeps current leg TPs', () => {
  const legs = [openLeg('a', 4335, '2026-01-01T00:00:00Z'), openLeg('b', 4330, '2026-01-01T00:00:01Z')]
  legs[0]!.tp = 4340
  legs[1]!.tp = 4350
  const preserved = preserveOpenLegTakeProfits(legs, [
    { stoploss: 4300, takeprofit: 4530 },
    { stoploss: 4300, takeprofit: 4510 },
  ])
  assert.equal(preserved[0]!.takeprofit, 4340)
  assert.equal(preserved[1]!.takeprofit, 4350)
})

test('preserveOpenLegTakeProfits: naked legs take the distributed TP spread (split-signal merge)', () => {
  // Bare entry opened 3 naked legs (tp=0); a TP/SL follow-up distributes TP1/TP2/TP3.
  // The v2 merge applies preserveOpenLegTakeProfits over the distributed per-leg
  // targets so each naked leg lands on its own TP (not all the deepest TP3).
  const legs = [
    openLeg('a', 4080, '2026-01-01T00:00:00Z'),
    openLeg('b', 4082, '2026-01-01T00:00:01Z'),
    openLeg('c', 4084, '2026-01-01T00:00:02Z'),
  ].map(l => ({ ...l, direction: 'sell' as const, tp: 0 }))
  const distributed = preserveOpenLegTakeProfits(legs, [
    { stoploss: 4090, takeprofit: 4075 },
    { stoploss: 4090, takeprofit: 4070 },
    { stoploss: 4090, takeprofit: 4065 },
  ])
  assert.deepEqual(distributed.map(t => t.takeprofit), [4075, 4070, 4065])
})

test('preserveOpenLegTakeProfits: never repaints legs that already carry a TP', () => {
  // Mixed basket: leg a already has a broker TP (distributed/hit), leg b is naked.
  // The existing TP must be preserved (no repaint after a TP is set); only the
  // naked leg receives its distributed value.
  const legs = [
    { ...openLeg('a', 4080, '2026-01-01T00:00:00Z'), direction: 'sell' as const, tp: 4075 },
    { ...openLeg('b', 4082, '2026-01-01T00:00:01Z'), direction: 'sell' as const, tp: 0 },
  ]
  const out = preserveOpenLegTakeProfits(legs, [
    { stoploss: 4090, takeprofit: 4070 },
    { stoploss: 4090, takeprofit: 4065 },
  ])
  assert.equal(out[0]!.takeprofit, 4075)
  assert.equal(out[1]!.takeprofit, 4065)
})

test('applyOpenLegStopLossToTargets: skipProtectiveMerge keeps the explicit resolved SL', () => {
  const legs = [
    { ...openLeg('a', 4165.25, '2026-01-01T00:00:00Z'), sl: 4164.25, direction: 'sell' as const },
    { ...openLeg('b', 4166, '2026-01-01T00:00:01Z'), sl: 4172.5, direction: 'sell' as const },
  ]
  const out = applyOpenLegStopLossToTargets(
    legs,
    [
      { stoploss: 4180, takeprofit: 4155 },
      { stoploss: 4180, takeprofit: 4150 },
    ],
    false,
    { skipProtectiveMerge: true },
  )
  // Explicit adjust (4180) is kept even though it loosens vs the 4164.25 leg.
  assert.ok(out.every(t => t.stoploss === 4180))
})

test('applyOpenLegStopLossToTargets: propagates sell breakeven SL to legs still on anchor', () => {
  const legs = [
    { ...openLeg('a', 4165.25, '2026-01-01T00:00:00Z'), sl: 4164.25, direction: 'sell' as const },
    { ...openLeg('b', 4165.25, '2026-01-01T00:00:01Z'), sl: 4172.5, direction: 'sell' as const },
  ]
  const applied = applyOpenLegStopLossToTargets(
    legs,
    [
      { stoploss: 4172.5, takeprofit: 4155 },
      { stoploss: 4172.5, takeprofit: 4150 },
    ],
    false,
  )
  assert.equal(applied[0]!.stoploss, 4164.25)
  assert.equal(applied[1]!.stoploss, 4164.25)
})

test('buildRangeBasketTpTargets: sell rebalance copies breakeven SL from open legs', () => {
  const legs = [
    { ...openLeg('a', 4165.25, '2026-01-01T00:00:00Z'), sl: 4164.25, direction: 'sell' as const },
    { ...openLeg('b', 4166, '2026-01-01T00:00:01Z'), sl: 4172.5, direction: 'sell' as const },
  ]
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4172.5, tp: [4155, 4150] },
    tpLots: TP_LOTS,
    direction: 'sell',
    activePendingCount: 0,
    maxPendingStepIdx: 10,
    forceLayeringRebalance: true,
  })
  assert.ok(targets.every(t => t.stoploss === 4164.25))
})

test('pickV2MergeDistributeTargets: revision repaints, normal distribute preserves', () => {
  const family = [{ ...openLeg('a', 4070, '2026-01-01T00:00:00Z'), tp: 4070 }]
  const distributed = [
    { stoploss: 4038, takeprofit: 4072 },
    { stoploss: 4038, takeprofit: 4067 },
  ]
  const preserved = pickV2MergeDistributeTargets(family, distributed, false)
  assert.equal(preserved[0]!.takeprofit, 4070)
  const revised = pickV2MergeDistributeTargets(family, distributed, true)
  assert.equal(revised[0]!.takeprofit, 4072)
})

test('rangeBasketTpRebalanceStatus: no TP ladder skip is logged as skipped, not failed', () => {
  assert.equal(
    rangeBasketTpRebalanceStatus({ modified: 0, attempted: 0, skippedReason: 'no_tp_ladder' }),
    'skipped',
  )
  assert.equal(
    rangeBasketTpRebalanceStatus({ modified: 0, attempted: 0 }),
    'success',
  )
  assert.equal(
    rangeBasketTpRebalanceStatus({ modified: 0, attempted: 3 }),
    'failed',
  )
  assert.equal(
    rangeBasketTpRebalanceStatus({ modified: 2, attempted: 3 }),
    'success',
  )
})

test('syncRangeBasketTakeProfits: no TP ladder skip writes status=skipped with no_tp_ladder reason', async () => {
  const captured: LogRow[] = []
  const family = Array.from({ length: 11 }, (_, i) => ({
    ...openLeg(`leg${i}`, 4389.69 - i * 0.4, `2026-08-12T02:23:0${i % 10}Z`),
    tp: 0,
  }))
  const supabase = fakeSupabaseForRebalance(family, captured)

  await syncRangeBasketTakeProfits({
    supabase: supabase as never,
    api: stubApi,
    uuid: 'uuid',
    symbol: 'XAUUSD',
    direction: 'buy',
    baseLot: 0.05,
    params: null,
    signalId: '2ffe9304',
    userId: 'user',
    brokerAccountId: 'broker',
    manual: { range_trading: true },
    parsed: { sl: 4376, tp: [] },
    forceLayeringRebalance: true,
  })

  const row = captured.find(r => r.action === 'range_basket_tp_rebalance')
  assert.ok(row, 'range_basket_tp_rebalance row should be logged')
  assert.equal(row!.status, 'skipped')
  assert.equal(row!.request_payload.attempted, 0)
  assert.equal(row!.request_payload.failed, 0)
  assert.equal(row!.request_payload.skipped_reason, 'no_tp_ladder')
  assert.equal(row!.request_payload.modified, 0)
})

test('classifyBasketTpSyncLegFailure: normalizes modify failures without raw broker payloads', () => {
  assert.equal(
    classifyBasketTpSyncLegFailure({
      error: 'TradingHelper.OrderModify timed out',
    }),
    'BROKER_TIMEOUT',
  )
  assert.equal(
    classifyBasketTpSyncLegFailure({
      error: 'Invalid stops',
    }),
    'INVALID_STOPS',
  )
  assert.equal(
    classifyBasketTpSyncLegFailure({
      error: 'ticket not in OpenedOrders',
      skip_reason: 'skipped_not_on_broker',
    }),
    'POSITION_GONE',
  )
})

test('syncRangeBasketTakeProfits: all legs succeed first pass emits no final failure', async () => {
  const family = [
    rangeSyncLeg('leg-1', 101, 4389),
    rangeSyncLeg('leg-2', 102, 4388),
  ]
  const api = apiForModifyPlan({ 101: ['ok'], 102: ['ok'] })
  const mock = await runRangeSyncScenario(family, api)

  assert.equal(mock.scopes.some(s => s.tags.event_name === 'basket_tp_sync_failed'), false)
  assert.deepEqual(api.calls.map(c => c.ticket).sort(), [101, 102])
})

test('syncRangeBasketTakeProfits: failed first pass that succeeds retry emits no final failure', async () => {
  const family = [
    rangeSyncLeg('leg-1', 201, 4389),
    rangeSyncLeg('leg-2', 202, 4388),
  ]
  const api = apiForModifyPlan({ 201: ['ok'], 202: ['timeout', 'ok'] })
  const mock = await runRangeSyncScenario(family, api)

  assert.equal(mock.scopes.some(s => s.tags.event_name === 'basket_tp_sync_failed'), false)
  assert.deepEqual(api.calls.map(c => c.ticket), [201, 202, 202])
})

test('syncRangeBasketTakeProfits: partial final failure captures safe context and retries only failed legs', async () => {
  const family = [
    rangeSyncLeg('leg-1', 301, 4389),
    rangeSyncLeg('leg-2', 302, 4388),
    rangeSyncLeg('leg-3', 303, 4387),
  ]
  const api = apiForModifyPlan({
    301: ['ok'],
    302: ['ok'],
    303: ['timeout', 'timeout'],
  })
  const mock = await runRangeSyncScenario(family, api)
  const extra = capturedBasketFailureExtra(mock)
  const scope = mock.scopes.find(s => s.tags.event_name === 'basket_tp_sync_failed')!

  assert.equal(scope.level, 'warning')
  assert.equal(scope.tags.reason_code, 'BASKET_TP_SYNC_FINAL_FAILURE')
  assert.equal(extra.partial_success, true)
  assert.equal(extra.total_failure, false)
  assert.equal(extra.targeted_count, 4)
  assert.equal(extra.successful_count, 2)
  assert.equal(extra.failed_count, 1)
  assert.equal(extra.final_retry_exhausted, true)
  assert.equal(extra.retry_pass_count, 1)
  assert.equal(extra.underlying_failure_category, 'BROKER_TIMEOUT')
  assert.deepEqual(extra.underlying_failure_categories, { BROKER_TIMEOUT: 1 })
  assert.equal(extra.failed_leg_diagnostic_count, 1)
  assert.deepEqual(api.calls.map(c => c.ticket), [301, 302, 303, 303])
  const diagnostics = extra.failed_leg_diagnostics as Array<Record<string, unknown>>
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0]!.trade_id, 'leg-3')
  assert.equal(diagnostics[0]!.ticket, 303)
  assert.equal(diagnostics[0]!.failure_category, 'BROKER_TIMEOUT')
  assert.equal(typeof diagnostics[0]!.desired_sl, 'number')
  assert.equal(typeof diagnostics[0]!.desired_tp, 'number')
  const payload = JSON.stringify(scope)
  assert.doesNotMatch(payload, /TradingHelper\.OrderModify timed out/)
  assert.doesNotMatch(payload, /password|token|session_string/i)
})

test('syncRangeBasketTakeProfits: total final failure keeps error severity and total-failure context', async () => {
  const family = [
    rangeSyncLeg('leg-1', 401, 4389),
    rangeSyncLeg('leg-2', 402, 4388),
  ]
  const api = apiForModifyPlan({
    401: ['timeout', 'timeout'],
    402: ['timeout', 'timeout'],
  })
  const mock = await runRangeSyncScenario(family, api)
  const extra = capturedBasketFailureExtra(mock)
  const scope = mock.scopes.find(s => s.tags.event_name === 'basket_tp_sync_failed')!

  assert.equal(scope.level, 'error')
  assert.equal(extra.partial_success, false)
  assert.equal(extra.total_failure, true)
  assert.equal(extra.successful_count, 0)
  assert.equal(extra.failed_count, 2)
  assert.deepEqual(extra.underlying_failure_categories, { BROKER_TIMEOUT: 2 })
  assert.deepEqual(api.calls.map(c => c.ticket), [401, 402, 401, 402])
})
