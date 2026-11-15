import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sendImmediateLegs } from './orderLegExecution'

function supabaseMock(inserts: unknown[] = []) {
  return {
    from: (table: string) => ({
      insert: (row: unknown) => {
        inserts.push(row)
        if (table === 'trades') {
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'trade-test' }, error: null }),
            }),
          }
        }
        return Promise.resolve({ data: null, error: null })
      },
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) delete process.env[key]
  else process.env[key] = value
}

describe('sendImmediateLegs single-style percent-split', () => {
  it('sends multiple distinct TP legs for single style (no hard block)', async () => {
    const originalEngine = process.env.EXECUTION_ENGINE
    const originalBrokers = process.env.EXECUTION_ENGINE_V2_BROKERS
    const originalUsers = process.env.EXECUTION_ENGINE_V2_USERS
    delete process.env.EXECUTION_ENGINE
    delete process.env.EXECUTION_ENGINE_V2_BROKERS
    delete process.env.EXECUTION_ENGINE_V2_USERS

    const inserts: unknown[] = []
    let ticket = 100
    const sent: unknown[] = []
    const api = {
      orderSend: async (args: unknown) => {
        sent.push(args)
        ticket += 1
        return {
          ticket,
          openPrice: 100,
          stopLoss: 99,
          takeProfit: (args as { takeprofit?: number }).takeprofit ?? 101,
          lots: (args as { volume?: number }).volume ?? 0.01,
        }
      },
      quote: async () => ({ bid: 99.9, ask: 100.1 }),
      openedOrders: async () => [],
    }

    try {
      const result = await sendImmediateLegs({
        ctx: {
          supabase: supabaseMock(inserts),
          markBrokerSessionDown: async () => {},
          deferredVirtualPendingMaterialize: async () => {},
          syncMultiBasketLegTakeProfits: async () => {},
          closeOppositeDirectionTrades: async () => {},
        },
        signal: {
          id: 'sig-split',
          user_id: 'u1',
          channel_id: 'c1',
          telegram_message_id: 'tg1',
          pipeline_ts: {},
        },
        parsed: { action: 'buy', symbol: 'XAUUSD', tp: [101, 102] },
        broker: { id: 'b1', user_id: 'u1', platform: 'MT5', default_lot_size: 0.01 },
        manual: { trade_style: 'single' },
        api,
        uuid: 'uuid-1',
        symbol: 'XAUUSD',
        requestedSymbol: 'XAUUSD',
        mapping: { symbol: 'XAUUSD', whitelist: [], userDecorated: false },
        params: null,
        legs: [
          {
            idx: 0,
            args: {
              symbol: 'XAUUSD', operation: 'Buy', volume: 0.01, price: 100,
              stoploss: 99, takeprofit: 101, slippage: 20, comment: 'TScopier:a:tp1', expertID: 1,
            },
          },
          {
            idx: 1,
            args: {
              symbol: 'XAUUSD', operation: 'Buy', volume: 0.02, price: 100,
              stoploss: 99, takeprofit: 102, slippage: 20, comment: 'TScopier:a:tp2', expertID: 1,
            },
          },
        ],
        liveEntryFast: false,
        strictEntryPrefetch: null,
        channelDelayMs: 0,
        channelDelaySkipped: false,
        deferVirtualAnchor: false,
        deferBrokerRangePendingMaterialize: false,
        brokerPendingMode: false,
        prepAnchor: null,
        prepAnchorSource: 'unknown',
        virtualPendings: [],
        plan: { orders: [] },
        materializedVirtuals: false,
        strictBrokerPlaced: false,
        strictDeferred: false,
        op: 'Buy',
        channelKeywords: null,
        baseLot: 0.01,
        syncMultiLegTps: false,
        prep: {} as never,
      } as never)

      assert.notEqual(result.failureReason, 'single_style_multi_leg_blocked')
      assert.equal(
        inserts.some(r => (r as { action?: string }).action === 'single_style_multi_leg_blocked'),
        false,
      )
      assert.ok(sent.length >= 1)
    } finally {
      restoreEnv('EXECUTION_ENGINE', originalEngine)
      restoreEnv('EXECUTION_ENGINE_V2_BROKERS', originalBrokers)
      restoreEnv('EXECUTION_ENGINE_V2_USERS', originalUsers)
    }
  })

  it('collapses identical clones to one send for multi style', async () => {
    const originalEngine = process.env.EXECUTION_ENGINE
    const originalBrokers = process.env.EXECUTION_ENGINE_V2_BROKERS
    const originalUsers = process.env.EXECUTION_ENGINE_V2_USERS
    delete process.env.EXECUTION_ENGINE
    delete process.env.EXECUTION_ENGINE_V2_BROKERS
    delete process.env.EXECUTION_ENGINE_V2_USERS

    const inserts: unknown[] = []
    const sent: unknown[] = []
    const api = {
      orderSend: async (args: unknown) => {
        sent.push(args)
        return { ticket: 1, openPrice: 100, stopLoss: 99, takeProfit: 101, lots: 0.4 }
      },
      quote: async () => ({ bid: 99.9, ask: 100.1 }),
      openedOrders: async () => [],
    }

    try {
      await sendImmediateLegs({
        ctx: {
          supabase: supabaseMock(inserts),
          markBrokerSessionDown: async () => {},
          deferredVirtualPendingMaterialize: async () => {},
          syncMultiBasketLegTakeProfits: async () => {},
          closeOppositeDirectionTrades: async () => {},
        },
        signal: {
          id: 'sig-collapse',
          user_id: 'u1',
          channel_id: 'c1',
          telegram_message_id: 'tg1',
          pipeline_ts: {},
        },
        parsed: { action: 'buy', symbol: 'XAUUSD', tp: [] },
        broker: { id: 'b1', user_id: 'u1', platform: 'MT5', default_lot_size: 0.4 },
        manual: { trade_style: 'multi' },
        api,
        uuid: 'uuid-1',
        symbol: 'XAUUSD',
        requestedSymbol: 'XAUUSD',
        mapping: { symbol: 'XAUUSD', whitelist: [], userDecorated: false },
        params: null,
        legs: [
          {
            idx: 0,
            args: {
              symbol: 'XAUUSD', operation: 'Buy', volume: 0.4, price: 100,
              stoploss: 99, takeprofit: 101, slippage: 20, comment: 'TScopier:a', expertID: 1,
            },
          },
          {
            idx: 1,
            args: {
              symbol: 'XAUUSD', operation: 'Buy', volume: 0.4, price: 100,
              stoploss: 99, takeprofit: 101, slippage: 20, comment: 'TScopier:a', expertID: 1,
            },
          },
        ],
        liveEntryFast: false,
        strictEntryPrefetch: null,
        channelDelayMs: 0,
        channelDelaySkipped: false,
        deferVirtualAnchor: false,
        deferBrokerRangePendingMaterialize: false,
        brokerPendingMode: false,
        prepAnchor: null,
        prepAnchorSource: 'unknown',
        virtualPendings: [],
        plan: { orders: [] },
        materializedVirtuals: false,
        strictBrokerPlaced: false,
        strictDeferred: false,
        op: 'Buy',
        channelKeywords: null,
        baseLot: 0.4,
        syncMultiLegTps: false,
        prep: {} as never,
      } as never)

      assert.equal(sent.length, 1)
    } finally {
      restoreEnv('EXECUTION_ENGINE', originalEngine)
      restoreEnv('EXECUTION_ENGINE_V2_BROKERS', originalBrokers)
      restoreEnv('EXECUTION_ENGINE_V2_USERS', originalUsers)
    }
  })
})
