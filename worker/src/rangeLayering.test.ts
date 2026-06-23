import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adverseMoveReached,
  buildRelativeMaterializationTriggers,
  computeFirstFillAnchor,
  computeNextLayerTrigger,
  inactiveLayerTrigger,
  rangeLayerRelativeStepEnabled,
  resolveEffectiveLayerTriggerPrice,
  resolveLayerReferenceEntry,
  stepPriceOffsetFromPips,
} from './rangeLayering'

describe('rangeLayering', () => {
  it('rangeLayerRelativeStepEnabled defaults to true', () => {
    const prev = process.env.RANGE_LAYER_RELATIVE_STEP
    delete process.env.RANGE_LAYER_RELATIVE_STEP
    assert.equal(rangeLayerRelativeStepEnabled(), true)
    process.env.RANGE_LAYER_RELATIVE_STEP = 'false'
    assert.equal(rangeLayerRelativeStepEnabled(), false)
    if (prev == null) delete process.env.RANGE_LAYER_RELATIVE_STEP
    else process.env.RANGE_LAYER_RELATIVE_STEP = prev
  })

  it('computeFirstFillAnchor VWAPs immediate fills', () => {
    const anchor = computeFirstFillAnchor([
      { entryPrice: 4130, lot_size: 0.1 },
      { entryPrice: 4132, lot_size: 0.1 },
    ])
    assert.equal(anchor, 4131)
  })

  it('XAUUSD 3-pip sell ladder from first fill 4130.25', () => {
    const pip = 0.1
    const step = stepPriceOffsetFromPips(3, pip)
    assert.ok(Math.abs(step - 0.3) < 1e-9)
    const trigger = computeNextLayerTrigger({
      isBuy: false,
      lastEntryPrice: 4130.25,
      stepPriceOffset: step,
      digits: 2,
    })
    assert.equal(trigger, 4130.55)
  })

  it('adverseMoveReached for sell requires ask at least step above last entry', () => {
    const step = 0.3
    assert.equal(
      adverseMoveReached({
        isBuy: false,
        lastEntry: 4130.25,
        stepPriceOffset: step,
        bid: 4130.4,
        ask: 4130.5,
      }),
      false,
    )
    assert.equal(
      adverseMoveReached({
        isBuy: false,
        lastEntry: 4130.25,
        stepPriceOffset: step,
        bid: 4130.5,
        ask: 4130.6,
      }),
      true,
    )
  })

  it('resolveLayerReferenceEntry picks highest sell entry', () => {
    const ref = resolveLayerReferenceEntry(
      [
        { entry_price: 4130.25 },
        { entry_price: 4131.08 },
      ],
      false,
    )
    assert.equal(ref, 4131.08)
  })

  it('resolveEffectiveLayerTriggerPrice uses worst open fill in relative mode', () => {
    const trigger = resolveEffectiveLayerTriggerPrice({
      relativeMode: true,
      isBuy: true,
      plannedTrigger: 4124.70,
      anchorPrice: 4129.70,
      lastEntry: 4125.00,
      stepPriceOffset: 0.3,
      digits: 2,
    })
    assert.equal(trigger, 4124.70)
  })

  it('resolveEffectiveLayerTriggerPrice ignores stale low planned trigger when relative ref is higher', () => {
    const trigger = resolveEffectiveLayerTriggerPrice({
      relativeMode: true,
      isBuy: true,
      plannedTrigger: 4124.20,
      anchorPrice: 4129.70,
      lastEntry: 4129.70,
      stepPriceOffset: 0.3,
      digits: 2,
    })
    assert.equal(trigger, 4129.40)
  })

  it('buildRelativeMaterializationTriggers only activates shallowest step', () => {
    const triggers = buildRelativeMaterializationTriggers({
      anchor: 4130.25,
      isBuy: false,
      stepPriceOffset: 0.3,
      digits: 2,
      stepIndices: [1, 2, 3],
    })
    assert.equal(triggers.get(1), 4130.55)
    assert.equal(triggers.get(2), inactiveLayerTrigger(false))
    assert.equal(triggers.get(3), inactiveLayerTrigger(false))
  })
})
