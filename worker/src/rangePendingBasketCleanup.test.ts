import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGhostBasketLegs } from './basketSlTpReconcile'

describe('range pending cleanup — broker flat detection', () => {
  it('treats DB open legs missing from broker as ghosts (SL / manual close)', () => {
    const family = [
      {
        id: 't1',
        signal_id: 'sig-1',
        metaapi_order_id: '1001',
        opened_at: '',
        lot_size: 0.01,
        sl: null,
        tp: null,
        entry_price: 2000,
        direction: 'buy',
        symbol: 'XAUUSD',
      },
    ]
    const { onBroker, ghost } = classifyGhostBasketLegs(family, new Set())
    assert.equal(onBroker.length, 0)
    assert.equal(ghost.length, 1)
    assert.equal(ghost[0]?.id, 't1')
  })

  it('keeps legs that still exist on broker', () => {
    const family = [
      {
        id: 't1',
        signal_id: 'sig-1',
        metaapi_order_id: '1001',
        opened_at: '',
        lot_size: 0.01,
        sl: null,
        tp: null,
        entry_price: 2000,
        direction: 'buy',
        symbol: 'XAUUSD',
      },
    ]
    const { onBroker, ghost } = classifyGhostBasketLegs(family, new Set([1001]))
    assert.equal(onBroker.length, 1)
    assert.equal(ghost.length, 0)
  })
})
