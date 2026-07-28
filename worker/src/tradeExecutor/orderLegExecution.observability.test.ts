import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sendImmediateLegs } from './orderLegExecution'

describe('sendImmediateLegs observability', () => {
  it('starts broker OrderSend before structured broker_request_started logging runs', async () => {
    const originalLog = console.log
    const originalEngine = process.env.EXECUTION_ENGINE
    const originalBrokers = process.env.EXECUTION_ENGINE_V2_BROKERS
    const originalUsers = process.env.EXECUTION_ENGINE_V2_USERS
    delete process.env.EXECUTION_ENGINE
    delete process.env.EXECUTION_ENGINE_V2_BROKERS
    delete process.env.EXECUTION_ENGINE_V2_USERS

    const logs: string[] = []
    console.log = (line?: unknown) => {
      logs.push(String(line))
    }

    let orderSendStarted = false
    let resolveOrderSend: (value: { ticket: number; openPrice: number; stopLoss: number; takeProfit: number; lots: number }) => void
    const orderSendPromise = new Promise<{ ticket: number; openPrice: number; stopLoss: number; takeProfit: number; lots: number }>(resolve => {
      resolveOrderSend = resolve
    })
    const api = {
      orderSend: () => {
        orderSendStarted = true
        return orderSendPromise
      },
      quote: async () => ({ bid: 99.9, ask: 100.1 }),
    }
    const signal = {
      id: 'signal-obs',
      user_id: 'user-obs',
      channel_id: 'channel-obs',
      telegram_message_id: 'tg-obs',
      pipeline_ts: {},
    }

    try {
      const done = sendImmediateLegs({
        ctx: {
          supabase: supabaseMock(),
          markBrokerSessionDown: async () => {},
          deferredVirtualPendingMaterialize: async () => {},
          syncMultiBasketLegTakeProfits: async () => {},
          closeOppositeDirectionTrades: async () => {},
        },
        signal,
        parsed: { action: 'buy', symbol: 'XAUUSD', tp: [] },
        broker: {
          id: 'broker-obs',
          user_id: 'user-obs',
          platform: 'MT4',
          default_lot_size: 0.01,
        },
        manual: { trade_style: 'single' },
        api,
        uuid: 'uuid-obs',
        symbol: 'XAUUSD',
        requestedSymbol: 'XAUUSD',
        mapping: { symbol: 'XAUUSD', whitelist: [], userDecorated: false },
        params: null,
        legs: [{
          idx: 0,
          args: {
            symbol: 'XAUUSD',
            operation: 'Buy',
            volume: 0.01,
            price: 100,
            stoploss: 99,
            takeprofit: 101,
            slippage: 20,
            comment: 'TScopier:test',
            expertID: 909090,
          },
        }],
        liveEntryFast: true,
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

      await Promise.resolve()
      assert.equal(orderSendStarted, true)
      assert.equal(logs.some(line => line.includes('"broker_request_started"')), false)
      assert.equal((signal.pipeline_ts as { broker_request_started_at?: number }).broker_request_started_at != null, true)

      resolveOrderSend!({ ticket: 123, openPrice: 100.1, stopLoss: 99, takeProfit: 101, lots: 0.01 })
      const result = await done
      assert.equal(result.openedOrMerged, true)
      await waitImmediate()
      assert.equal(logs.some(line => line.includes('"broker_request_started"')), true)
    } finally {
      console.log = originalLog
      restoreEnv('EXECUTION_ENGINE', originalEngine)
      restoreEnv('EXECUTION_ENGINE_V2_BROKERS', originalBrokers)
      restoreEnv('EXECUTION_ENGINE_V2_USERS', originalUsers)
    }
  })
})

function supabaseMock() {
  return {
    from: (table: string) => ({
      insert: () => {
        if (table === 'trades') {
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'trade-obs' }, error: null }),
            }),
          }
        }
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }
}

function waitImmediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) delete process.env[key]
  else process.env[key] = value
}
