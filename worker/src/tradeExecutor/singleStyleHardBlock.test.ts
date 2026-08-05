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
    }),
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) delete process.env[key]
  else process.env[key] = value
}

describe('sendImmediateLegs single-style hard block', () => {
  it('sends zero orders when single style has multiple distinct legs', async () => {
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
        return { ticket: 1, openPrice: 100, stopLoss: 99, takeProfit: 101, lots: 0.01 }
      },
      quote: async () => ({ bid: 99.9, ask: 100.1 }),
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
          id: 'sig-block',
          user_id: 'u1',
          channel_id: 'c1',
          telegram_message_id: 'tg1',
          pipeline_ts: {},
        },
        parsed: { action: 'buy', symbol: 'XAUUSD', tp: [] },
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

      assert.equal(sent.length, 0)
      assert.equal(result.failureReason, 'single_style_multi_leg_blocked')
      assert.equal(
        inserts.some(r => (r as { action?: string }).action === 'single_style_multi_leg_blocked'),
        true,
      )
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
      orderSend: async (_uuid: string, args: { volume: number }) => {
        sent.push(args)
        return { ticket: sent.length + 10, openPrice: 100, stopLoss: 0, takeProfit: 0, lots: args.volume }
      },
      quote: async () => ({ bid: 99.9, ask: 100.1 }),
    }
    const cloneArgs = {
      symbol: 'XAUUSD', operation: 'Buy' as const, volume: 0.4, price: 100,
      stoploss: 0, takeprofit: 0, slippage: 20, comment: 'TScopier:44sClub:979b6ac0', expertID: 1,
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
          id: 'sig-clone',
          user_id: 'u1',
          channel_id: 'c1',
          telegram_message_id: 'tg1',
          pipeline_ts: {},
        },
        parsed: { action: 'buy', symbol: 'XAUUSD', tp: [] },
        broker: { id: 'b1', user_id: 'u1', platform: 'MT5', default_lot_size: 0.01 },
        manual: { trade_style: 'multi' },
        api,
        uuid: 'uuid-1',
        symbol: 'XAUUSD',
        requestedSymbol: 'XAUUSD',
        mapping: { symbol: 'XAUUSD', whitelist: [], userDecorated: false },
        params: null,
        legs: [
          { idx: 0, args: { ...cloneArgs } },
          { idx: 1, args: { ...cloneArgs } },
          { idx: 2, args: { ...cloneArgs } },
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
      assert.equal(result.openedOrMerged, true)
      assert.equal(
        inserts.some(r => (r as { action?: string }).action === 'duplicate_leg_collapsed'),
        true,
      )
    } finally {
      restoreEnv('EXECUTION_ENGINE', originalEngine)
      restoreEnv('EXECUTION_ENGINE_V2_BROKERS', originalBrokers)
      restoreEnv('EXECUTION_ENGINE_V2_USERS', originalUsers)
    }
  })
})
