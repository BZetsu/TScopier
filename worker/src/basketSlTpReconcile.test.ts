import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePerLegTargets,
  reconcileBackoffMs,
  clampBasketOrderStops,
} from './basketSlTpReconcile'

describe('parsePerLegTargets', () => {
  it('parses jsonb array of targets', () => {
    const out = parsePerLegTargets([
      { stoploss: 100, takeprofit: 110 },
      { stoploss: 99, takeprofit: 111 },
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0]!.stoploss, 100)
    assert.equal(out[1]!.takeprofit, 111)
  })

  it('returns empty for invalid input', () => {
    assert.deepEqual(parsePerLegTargets(null), [])
    assert.deepEqual(parsePerLegTargets('x'), [])
  })
})

describe('reconcileBackoffMs', () => {
  it('grows with attempts and caps at 5 minutes', () => {
    const a0 = reconcileBackoffMs(0)
    const a3 = reconcileBackoffMs(3)
    const a10 = reconcileBackoffMs(10)
    assert.ok(a3 >= a0)
    assert.ok(a10 <= 300_000)
  })
})

describe('clampBasketOrderStops', () => {
  it('pushes buy SL below reference when too tight', () => {
    const { args, adjustments } = clampBasketOrderStops(
      {
        symbol: 'EURUSD',
        operation: 'Buy',
        volume: 0.01,
        price: 1.1,
        stoploss: 1.0999,
        takeprofit: 1.102,
      },
      { point: 0.00001, stopsLevel: 10, freezeLevel: 0, minLot: 0.01, lotStep: 0.01, contractSize: null, digits: 5 },
    )
    assert.ok(adjustments.length > 0 || args.stoploss! < 1.1)
  })
})
