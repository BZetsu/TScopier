import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeBasketTargetStops } from './basketTargetStops'

describe('sanitizeBasketTargetStops', () => {
  it('rejects sell SL that sits inside the TP ladder', () => {
    const out = sanitizeBasketTargetStops({
      isBuy: false,
      referencePrice: 4064,
      stoploss: 4040,
      tpLevels: [4080, 4071, 4040],
    })
    assert.equal(out.stoploss, null)
    assert.ok(out.rejected.length > 0)
  })

  it('keeps coherent sell stops', () => {
    const out = sanitizeBasketTargetStops({
      isBuy: false,
      referencePrice: 4080,
      stoploss: 4090,
      tpLevels: [4071, 4040],
    })
    assert.equal(out.stoploss, 4090)
    assert.deepEqual(out.tpLevels, [4071, 4040])
  })
})
