import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveRangeLayerStepPips } from './resolveRangeLayerStepPips'

test('resolveRangeLayerStepPips: manual step', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 3, distPips: 30, reservedLegs: 8 })
  assert.deepEqual(r, { effectiveStepPips: 3, auto: false, fittedLegs: 8 })
})

test('resolveRangeLayerStepPips: Auto from blank/0', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 0, distPips: 30, reservedLegs: 8 })
  assert.ok(r)
  assert.equal(r.auto, true)
  assert.equal(r.effectiveStepPips, 3.75)
  assert.equal(r.fittedLegs, 8)
})

test('resolveRangeLayerStepPips: forceAuto overrides manual', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 5, distPips: 30, reservedLegs: 10, forceAuto: true })
  assert.deepEqual(r, { effectiveStepPips: 3, auto: true, fittedLegs: 10 })
})

test('resolveRangeLayerStepPips: Auto never packs below 1 pip', () => {
  // 26 reserved into ~7.8 pips (live incident) → fit 7 legs at ~1.11 pips, not 0.3
  const r = resolveRangeLayerStepPips({ stepPips: 0, distPips: 7.8, reservedLegs: 26 })
  assert.ok(r)
  assert.equal(r.auto, true)
  assert.equal(r.fittedLegs, 7)
  assert.ok(Math.abs(r.effectiveStepPips - (7.8 / 7)) < 1e-9)
  assert.ok(r.effectiveStepPips >= 1)
})

test('resolveRangeLayerStepPips: null when no reserved or distance', () => {
  assert.equal(resolveRangeLayerStepPips({ stepPips: 0, distPips: 30, reservedLegs: 0 }), null)
  assert.equal(resolveRangeLayerStepPips({ stepPips: 3, distPips: 0, reservedLegs: 8 }), null)
})
