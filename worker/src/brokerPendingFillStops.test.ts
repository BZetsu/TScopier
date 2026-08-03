import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFiringLegStops } from './rangeBasketTpSync'

describe('naked broker pending fill stops', () => {
  it('resolveFiringLegStops uses effective SL and leg/deepest TP', () => {
    const out = resolveFiringLegStops({
      legStoploss: 4000,
      legTakeprofit: 4100,
      cweClosePrice: null,
      effective: { stoploss: 3990, tpLevels: [4080, 4100, 4120] },
      isBuy: true,
    })
    assert.equal(out.stoploss, 3990)
    assert.equal(out.takeprofit, 4100)
  })

  it('resolveFiringLegStops backfills naked leg TP from deepest ladder', () => {
    const out = resolveFiringLegStops({
      legStoploss: 4000,
      legTakeprofit: null,
      cweClosePrice: null,
      effective: { stoploss: 4000, tpLevels: [4080, 4100, 4120] },
      isBuy: true,
    })
    assert.equal(out.stoploss, 4000)
    assert.equal(out.takeprofit, 4120)
  })

  it('resolveFiringLegStops keeps CWE fills TP-less', () => {
    const out = resolveFiringLegStops({
      legStoploss: 4000,
      legTakeprofit: 4100,
      cweClosePrice: 4050,
      effective: { stoploss: 4000, tpLevels: [4100] },
      isBuy: true,
    })
    assert.equal(out.stoploss, 4000)
    assert.equal(out.takeprofit, 0)
  })

  it('falls back to leg SL when effective SL missing', () => {
    const out = resolveFiringLegStops({
      legStoploss: 4010,
      legTakeprofit: 4110,
      cweClosePrice: null,
      effective: { stoploss: 0, tpLevels: [] },
      isBuy: false,
    })
    assert.equal(out.stoploss, 4010)
    assert.equal(out.takeprofit, 4110)
  })
})
