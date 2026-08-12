import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, test } from 'node:test'
import { runRangeEntry } from './rangeTradeExecutor'
import type { BrokerRow, ParsedSignal, SignalRow } from './types'

let previousApiKey: string | undefined

beforeEach(() => {
  previousApiKey = process.env.FXSOCKET_API_KEY
  process.env.FXSOCKET_API_KEY = 'test-key'
})

afterEach(() => {
  if (previousApiKey == null) delete process.env.FXSOCKET_API_KEY
  else process.env.FXSOCKET_API_KEY = previousApiKey
})

test('range deferred-only BUY registers one virtual dip leg without broker OrderSend', async () => {
  const ctx = makeRangeCtx()
  const result = await runRangeEntry(ctx as never, {
    signal: baseSignal('signal-buy-deferred'),
    parsed: baseParsed('buy'),
    op: 'Buy',
    broker: baseBroker(),
    channelKeywords: null,
  })

  assert.equal(result.openedOrMerged, true)
  assert.equal(ctx.orderSends, 0)
  assert.equal(ctx.skips.length, 0)
  assert.equal(ctx.persistedRows.length, 1)
  const row = ctx.persistedRows[0]!
  assert.equal(row.status, 'pending')
  assert.equal(row.signal_id, 'signal-buy-deferred')
  assert.equal(row.is_buy, true)
  assert.equal(row.anchor_price, 2400)
  assert.ok(Number(row.trigger_price) < 2400)
  assert.equal(row.step_idx, 1)
})

test('range deferred-only SELL registers one virtual rally leg without broker OrderSend', async () => {
  const ctx = makeRangeCtx()
  const result = await runRangeEntry(ctx as never, {
    signal: baseSignal('signal-sell-deferred'),
    parsed: baseParsed('sell'),
    op: 'Sell',
    broker: baseBroker(),
    channelKeywords: null,
  })

  assert.equal(result.openedOrMerged, true)
  assert.equal(ctx.orderSends, 0)
  assert.equal(ctx.skips.length, 0)
  assert.equal(ctx.persistedRows.length, 1)
  const row = ctx.persistedRows[0]!
  assert.equal(row.status, 'pending')
  assert.equal(row.signal_id, 'signal-sell-deferred')
  assert.equal(row.is_buy, false)
  assert.equal(row.anchor_price, 2400)
  assert.ok(Number(row.trigger_price) > 2400)
  assert.equal(row.step_idx, 1)
})

test('truly empty range plan is still skipped', async () => {
  const ctx = makeRangeCtx()
  const result = await runRangeEntry(ctx as never, {
    signal: baseSignal('signal-empty-plan'),
    parsed: { ...baseParsed('buy'), entry_price: null },
    op: 'Buy',
    broker: baseBroker({
      use_signal_entry_range: true,
    }),
    channelKeywords: null,
  })

  assert.equal(result.openedOrMerged, undefined)
  assert.equal(result.signalRangeEntryRequiredSkip, true)
  assert.equal(ctx.orderSends, 0)
  assert.equal(ctx.persistedRows.length, 0)
  assert.deepEqual(ctx.skips.map(s => s.reason), ['signal_entry_range_requires_price'])
  assert.deepEqual(ctx.dispatchClaimReleases, [{
    signal_id: 'signal-empty-plan',
    broker_account_id: 'broker-deferred',
  }])
})

function baseSignal(id: string): SignalRow {
  return {
    id,
    user_id: 'user-deferred',
    channel_id: null,
    parsed_data: null,
    status: 'parsed',
    parent_signal_id: null,
    is_modification: false,
  }
}

function baseParsed(side: 'buy' | 'sell'): ParsedSignal {
  return {
    action: side,
    symbol: 'XAUUSD',
    entry_price: 2400,
    entry_zone_low: null,
    entry_zone_high: null,
    sl: side === 'buy' ? 2390 : 2410,
    tp: side === 'buy' ? [2410] : [2390],
    lot_size: null,
  }
}

function baseBroker(manualOverrides: Record<string, unknown> = {}): BrokerRow {
  return {
    id: 'broker-deferred',
    user_id: 'user-deferred',
    is_active: true,
    platform: 'MT4',
    fxsocket_account_id: 'uuid-deferred',
    metaapi_account_id: null,
    account_login: '1001',
    broker_server: 'demo',
    copier_mode: 'manual',
    signal_channel_ids: ['channel-deferred'],
    enforce_signal_channel_filter: true,
    ai_settings: null,
    manual_settings: {
      risk_mode: 'fixed_lot',
      fixed_lot: 0.01,
      trade_style: 'multi',
      multi_trade_leg_percent: 100,
      multi_trade_max_orders: 1,
      range_trading: true,
      range_percent: 100,
      range_step_pips: 10,
      range_distance_pips: 10,
      range_layering_type: 'auto',
      tp_lots: [{ label: 'TP1', lot: 0, percent: 100, enabled: true }],
      pending_expiry_hours: 4,
      ...manualOverrides,
    },
    default_lot_size: 0.01,
    last_balance: null,
    last_equity: null,
    last_currency: 'USD',
    channel_message_filters: null,
    channel_trading_configs: null,
  }
}

function makeRangeCtx() {
  const persistedRows: Record<string, unknown>[] = []
  const logs: Record<string, unknown>[] = []
  const skips: Array<{ signalId: string; brokerId: string; reason: string }> = []
  const dispatchClaimReleases: Array<{ signal_id?: unknown; broker_account_id?: unknown }> = []
  let orderSends = 0
  const supabase = {
    from: (table: string) => makeSupabaseTable(table, logs, dispatchClaimReleases),
  }

  return {
    get orderSends() {
      return orderSends
    },
    persistedRows,
    dispatchClaimReleases,
    logs,
    skips,
    supabase,
    apiFor: () => ({
      quote: async () => ({ bid: 2399.9, ask: 2400.1 }),
      orderSend: async () => {
        orderSends += 1
        return { ticket: 1, openPrice: 2400.1, stopLoss: 2390, takeProfit: 2410, lots: 0.01 }
      },
    }),
    ensureBrokerSessionLiveFast: async () => true,
    resolveBrokerSymbol: async () => 'XAUUSD',
    getSymbolParams: async () => ({
      digits: 2,
      point: 0.01,
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
      contractSize: 100000,
      stopsLevel: 0,
      freezeLevel: 0,
      loadedAt: Date.now(),
    }),
    logSendSkipped: async (signal: SignalRow, broker: BrokerRow, reason: string) => {
      skips.push({ signalId: signal.id, brokerId: broker.id, reason })
    },
    tryTeaserCompletionMerge: async () => ({ handled: false }),
    tryParameterFollowUpMergeModifyOnly: async () => ({ handled: false }),
    tryMergeSignalIntoExistingOpenTrade: async () => ({ handled: false }),
    hasOpenTradeForSymbol: async () => false,
    manualDispatchAlreadyMaterialized: async () => false,
    persistRangePendingLegRows: async (rows: Record<string, unknown>[]) => {
      persistedRows.push(...rows)
      return { ok: true }
    },
    deferredVirtualPendingMaterialize: async () => {},
    syncMultiBasketLegTakeProfits: async () => {},
    closeOppositeDirectionTrades: async () => {},
  }
}

function makeSupabaseTable(
  table: string,
  logs: Record<string, unknown>[],
  dispatchClaimReleases: Array<{ signal_id?: unknown; broker_account_id?: unknown }>,
) {
  return {
    insert: (row: Record<string, unknown>) => {
      logs.push({ table, ...row })
      return Promise.resolve({ data: null, error: null })
    },
    delete: () => makeDeleteChain(table, dispatchClaimReleases),
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }
}

function makeDeleteChain(
  table: string,
  dispatchClaimReleases: Array<{ signal_id?: unknown; broker_account_id?: unknown }>,
) {
  const filters: { signal_id?: unknown; broker_account_id?: unknown } = {}
  const chain = {
    eq: (key: string, value: unknown) => {
      if (key === 'signal_id' || key === 'broker_account_id') {
        filters[key] = value
      }
      return chain
    },
    then: <TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> => {
      if (table === 'signal_broker_dispatch_claims') {
        dispatchClaimReleases.push({ ...filters })
      }
      return Promise.resolve({ error: null }).then(onfulfilled, onrejected)
    },
  }
  return chain
}
