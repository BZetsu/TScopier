import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { shouldLockBasketLayering } from './virtualPendingMonitor'
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
                    eq() {
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
