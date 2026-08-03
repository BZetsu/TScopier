import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveRangeLayerStepPips } from './resolveRangeLayerStepPips'

test('resolveRangeLayerStepPips: manual step', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 3, distPips: 30, reservedLegs: 8 })
  assert.deepEqual(r, { effectiveStepPips: 3, auto: false })
})

test('resolveRangeLayerStepPips: Auto from blank/0', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 0, distPips: 30, reservedLegs: 8 })
  assert.ok(r)
  assert.equal(r.auto, true)
  assert.equal(r.effectiveStepPips, 3.75)
})

test('resolveRangeLayerStepPips: forceAuto overrides manual', () => {
  const r = resolveRangeLayerStepPips({ stepPips: 5, distPips: 30, reservedLegs: 10, forceAuto: true })
  assert.deepEqual(r, { effectiveStepPips: 3, auto: true })
})

test('resolveRangeLayerStepPips: null when no reserved or distance', () => {
  assert.equal(resolveRangeLayerStepPips({ stepPips: 0, distPips: 30, reservedLegs: 0 }), null)
  assert.equal(resolveRangeLayerStepPips({ stepPips: 3, distPips: 0, reservedLegs: 8 }), null)
})
