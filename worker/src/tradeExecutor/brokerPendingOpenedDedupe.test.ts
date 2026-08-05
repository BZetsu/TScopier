import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { brokerLimitPriceKeysFromOpenedOrders } from './brokerPendingOpenedDedupe'

test('brokerLimitPriceKeysFromOpenedOrders collects SellLimit prices for symbol', () => {
  const keys = brokerLimitPriceKeysFromOpenedOrders({
    openedOrders: [
      { symbol: 'XAUUSDm', operation: 'SellLimit', openPrice: 4065.588, comment: 'TScopier:ch:abc:rg5.tp1' },
      { symbol: 'XAUUSDm', operation: 'SellLimit', openPrice: 4067.588, comment: 'TScopier:ch:abc:rg6.tp1' },
      { symbol: 'XAUUSDm', operation: 'Sell', openPrice: 4050, comment: 'TScopier:ch:abc' },
      { symbol: 'EURUSD', operation: 'SellLimit', openPrice: 1.1, comment: 'TScopier:ch:abc:rg1.tp1' },
    ],
    symbol: 'XAUUSDm',
    side: 'sell',
    digits: 3,
    commentNeedle: 'abc',
  })
  assert.deepEqual([...keys].sort(), ['4065.588', '4067.588'])
})

test('brokerLimitPriceKeysFromOpenedOrders ignores other signal comments', () => {
  const keys = brokerLimitPriceKeysFromOpenedOrders({
    openedOrders: [
      { symbol: 'XAUUSDm', operation: 'SellLimit', openPrice: 4065.588, comment: 'TScopier:ch:other:rg5.tp1' },
    ],
    symbol: 'XAUUSDm',
    side: 'sell',
    digits: 3,
    commentNeedle: 'abc',
  })
  assert.equal(keys.size, 0)
})
