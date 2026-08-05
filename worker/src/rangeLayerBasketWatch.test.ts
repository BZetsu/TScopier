import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { shouldLockBasketLayering } from './rangeBasketLayeringLock'
import { watchRangeLayeringBasketEvents } from './rangeLayerBasketWatch'

test('shouldLockBasketLayering: partial close locks layering stop', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [4480],
    openCount: 2,
    closedCount: 1,
    bid: 4490,
    ask: 4490.2,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'basket_partially_closed')
})

test('shouldLockBasketLayering: fully flat basket locks to stop post-close refire', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [],
    openCount: 0,
    closedCount: 17,
    bid: 4042,
    ask: 4042.2,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'basket_fully_closed')
})

test('watchRangeLayeringBasketEvents: no trades returns empty touched set', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            in() {
              return {
                in() {
                  return {
                    in() {
                      return Promise.resolve({ data: [], error: null })
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const touched = await watchRangeLayeringBasketEvents(supabase as never, {
    signalIds: ['sig-1'],
    brokerIds: ['broker-1'],
    symbol: 'XAUUSD',
    bid: 4500,
    ask: 4500.2,
  })
  assert.equal(touched.size, 0)
})

test('watchRangeLayeringBasketEvents: matches XAUUSDm trades when watching XAUUSD', async () => {
  const trades = [
    {
      signal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      broker_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      direction: 'sell',
      tp: 4040,
      status: 'open',
      symbol: 'XAUUSDm',
    },
    {
      signal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      broker_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      direction: 'sell',
      tp: 4040,
      status: 'closed',
      symbol: 'XAUUSDm',
    },
  ]
  let deleted = false
  let locked = false
  const supabase = {
    from(table: string) {
      if (table === 'trades') {
        const result = { data: trades, error: null, count: 1 }
        const chain: Record<string, unknown> = {}
        const cont = () => chain
        chain.select = cont
        chain.eq = cont
        chain.in = cont
        chain.then = (onfulfilled?: (v: typeof result) => unknown) =>
          Promise.resolve(result).then(onfulfilled as never)
        return chain
      }
      if (table === 'signals') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: { channel_id: 'ch-1' }, error: null }),
                }
              },
            }
          },
        }
      }
      if (table === 'broker_accounts') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      manual_settings: { range_layer_till_close: false },
                      channel_trading_configs: {},
                      copier_mode: 'manual',
                      ai_settings: {},
                      signal_channel_ids: [],
                    },
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'range_pending_legs') {
        const chain: Record<string, unknown> = {}
        const cont = () => chain
        chain.select = () => {
          // cancelBrokerPendingLegsForScope select → no broker tickets in unit test
          const sel: Record<string, unknown> = {}
          const selCont = () => sel
          sel.eq = selCont
          sel.in = selCont
          sel.then = (onfulfilled?: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(onfulfilled as never)
          return sel
        }
        chain.eq = cont
        chain.in = cont
        chain.delete = () => {
          deleted = true
          const del: Record<string, unknown> = {}
          const delCont = () => del
          del.eq = delCont
          del.in = delCont
          del.select = () => ({
            then: (onfulfilled?: (v: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve({ data: [{ id: 'leg-1' }], error: null }).then(onfulfilled as never),
          })
          return del
        }
        return chain
      }
      if (table === 'range_pending_tp_locks') {
        return {
          upsert: async () => {
            locked = true
            return { error: null }
          },
        }
      }
      if (table === 'trade_execution_logs') {
        return { insert: async () => ({ error: null }) }
      }
      const chain: Record<string, unknown> = {}
      const cont = () => chain
      chain.select = cont
      chain.eq = cont
      chain.in = cont
      chain.maybeSingle = async () => ({ data: null, error: null })
      chain.then = (onfulfilled?: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, count: 2 }).then(onfulfilled as never)
      return chain
    },
  }

  const touched = await watchRangeLayeringBasketEvents(supabase as never, {
    signalIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    brokerIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    symbol: 'XAUUSD',
    bid: 4050,
    ask: 4050.2,
    logAction: 'range_broker_pending_tp_lock',
  })
  assert.equal(touched.size, 1, 'TP/partial close with LTC off must stop layering')
  assert.equal(deleted, true, 'pending ladder rows must be deleted')
  assert.equal(locked, true, 'tp lock must be set')
})
