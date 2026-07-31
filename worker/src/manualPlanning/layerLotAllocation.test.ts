import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { allocateLayerLots } from './layerLotAllocation'

test('allocateLayerLots: 0.10 across 5 layers', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.10, layerCount: 5, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.lots, [0.02, 0.02, 0.02, 0.02, 0.02])
  assert.equal(out.allocatedTotalLot, 0.10)
  assert.equal(out.unallocatedLot, 0)
})

test('allocateLayerLots: 0.13 across 4 assigns remainder to earlier layers', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.13, layerCount: 4, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.lots, [0.04, 0.03, 0.03, 0.03])
  assert.equal(out.allocatedTotalLot, 0.13)
})

test('allocateLayerLots: 0.03 requested across 5 reduces funded count to 3', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.03, layerCount: 5, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.equal(out.fundedLayerCount, 3)
  assert.deepEqual(out.lots, [0.01, 0.01, 0.01])
  assert.deepEqual(out.reasons, ['funded_layer_count_reduced'])
})

test('allocateLayerLots: below minimum lot is rejected', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.005, layerCount: 1, minLot: 0.01, lotStep: 0.01 })
  assert.deepEqual(out, { ok: false, reason: 'total_lot_below_minimum' })
})

test('allocateLayerLots: just-below-step totals never round up into allocation', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.009999999999, layerCount: 5, minLot: 0.01, lotStep: 0.01 })
  assert.deepEqual(out, { ok: false, reason: 'total_lot_below_minimum' })
})

test('allocateLayerLots: just-above-step totals allocate at most the funded step', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.010000000001, layerCount: 5, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.lots, [0.01])
  assert.equal(out.allocatedTotalLot, 0.01)
  assert.ok(out.allocatedTotalLot <= out.intendedTotalLot)
})

test('allocateLayerLots: rejects invalid counts and lot constraints', () => {
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 0, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_layer_count',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: 0.1, layerCount: -1, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_layer_count',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 2.5, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_layer_count',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 2, minLot: 0, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_min_lot',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 2, minLot: 0.01, lotStep: 0 }), {
    ok: false,
    reason: 'invalid_lot_step',
  })
})

test('allocateLayerLots: rejects non-finite and negative total lots', () => {
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: Number.NaN, layerCount: 2, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_total_lot',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: Number.POSITIVE_INFINITY, layerCount: 2, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_total_lot',
  })
  assert.deepEqual(allocateLayerLots({ intendedTotalLot: -0.1, layerCount: 2, minLot: 0.01, lotStep: 0.01 }), {
    ok: false,
    reason: 'invalid_total_lot',
  })
})

test('allocateLayerLots: every lot is aligned, minimum-compliant, and never exceeds total', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.127, layerCount: 4, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.equal(out.allocatedTotalLot, 0.12)
  assert.equal(out.unallocatedLot, 0.007)
  assert.ok(out.reasons.includes('allocation_reduced_by_lot_step'))
  for (const lot of out.lots) {
    assert.ok(lot >= 0.01)
    assert.equal(Math.round(lot / 0.01), lot / 0.01)
  }
})

test('allocateLayerLots: handles non-aligned intended total and 0.1 + 0.2', () => {
  const nonAligned = allocateLayerLots({ intendedTotalLot: 1.005, layerCount: 3, minLot: 0.01, lotStep: 0.01 })
  assert.equal(nonAligned.ok, true)
  assert.equal(nonAligned.allocatedTotalLot, 1)
  assert.equal(nonAligned.unallocatedLot, 0.005)
  assert.ok(nonAligned.allocatedTotalLot <= nonAligned.intendedTotalLot)

  const sum = allocateLayerLots({ intendedTotalLot: 0.1 + 0.2, layerCount: 3, minLot: 0.01, lotStep: 0.01 })
  assert.equal(sum.ok, true)
  assert.deepEqual(sum.lots, [0.1, 0.1, 0.1])
  assert.ok(sum.allocatedTotalLot <= sum.intendedTotalLot)
})

test('allocateLayerLots: minLot and lotStep mismatch uses effective step-aligned minimum', () => {
  const minGreater = allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 3, minLot: 0.025, lotStep: 0.01 })
  assert.equal(minGreater.ok, true)
  assert.deepEqual(minGreater.lots, [0.04, 0.03, 0.03])
  assert.ok(minGreater.lots.every(lot => lot >= 0.03))

  const stepGreater = allocateLayerLots({ intendedTotalLot: 0.1, layerCount: 3, minLot: 0.01, lotStep: 0.03 })
  assert.equal(stepGreater.ok, true)
  assert.deepEqual(stepGreater.lots, [0.03, 0.03, 0.03])
  assert.equal(stepGreater.allocatedTotalLot, 0.09)
})

test('allocateLayerLots: duplicate-price reduced layer count redistributes total', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.10, layerCount: 4, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.lots, [0.03, 0.03, 0.02, 0.02])
})

test('allocateLayerLots: handles small floating-point values and max layer count', () => {
  const small = allocateLayerLots({ intendedTotalLot: 0.030000000000000002, layerCount: 3, minLot: 0.01, lotStep: 0.01 })
  assert.equal(small.ok, true)
  assert.deepEqual(small.lots, [0.01, 0.01, 0.01])

  const large = allocateLayerLots({ intendedTotalLot: 1, layerCount: 20, minLot: 0.01, lotStep: 0.01 })
  assert.equal(large.ok, true)
  assert.equal(large.lots.length, 20)
  assert.equal(large.allocatedTotalLot, 1)
})

test('allocateLayerLots: supports very small valid lot steps', () => {
  const out = allocateLayerLots({ intendedTotalLot: 0.00003, layerCount: 3, minLot: 0.00001, lotStep: 0.00001 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.lots, [0.00001, 0.00001, 0.00001])
  assert.equal(out.allocatedTotalLot, 0.00003)
})

test('allocateLayerLots: invariant table never exceeds intended total', () => {
  const cases = [
    { intendedTotalLot: 0.01, layerCount: 1, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 0.010000000001, layerCount: 2, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 0.03, layerCount: 5, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 0.11, layerCount: 3, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 0.1 + 0.2, layerCount: 20, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 1.005, layerCount: 20, minLot: 0.01, lotStep: 0.01 },
    { intendedTotalLot: 0.00003, layerCount: 4, minLot: 0.00001, lotStep: 0.00001 },
  ]
  for (const input of cases) {
    const out = allocateLayerLots(input)
    if (!out.ok) continue
    assert.ok(out.allocatedTotalLot <= out.intendedTotalLot, JSON.stringify({ input, out }))
    assert.ok(out.unallocatedLot >= 0, JSON.stringify({ input, out }))
    for (const lot of out.lots) {
      assert.ok(lot >= input.minLot)
      assert.equal(Math.round(lot / input.lotStep), lot / input.lotStep)
    }
  }
})

test('allocateLayerLots: does not mutate input and is repeatable', () => {
  const input = Object.freeze({ intendedTotalLot: 0.13, layerCount: 4, minLot: 0.01, lotStep: 0.01 })
  const a = allocateLayerLots(input)
  const b = allocateLayerLots(input)
  assert.deepEqual(a, b)
  assert.deepEqual(input, { intendedTotalLot: 0.13, layerCount: 4, minLot: 0.01, lotStep: 0.01 })
})
