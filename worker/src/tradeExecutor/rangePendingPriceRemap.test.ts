import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { consumedStepIndices, type RangeLegRow } from '../rangePendingLadderSync'
import {
  isBrokerPendingLimitPriceRejectMessage,
  nextValidRangePendingPrice,
  orderRangePendingCandidates,
} from './rangePendingPriceRemap'

test('orderRangePendingCandidates: buy orders shallow (high) to deep (low)', () => {
  const ordered = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4061 },
      { stepIdx: 2, price: 4059 },
      { stepIdx: 3, price: 4055 },
      { stepIdx: 4, price: 4051 },
    ],
    true,
  )
  assert.deepEqual(ordered.map(c => c.price), [4061, 4059, 4055, 4051])
})

test('orderRangePendingCandidates: sell orders shallow (low) to deep (high)', () => {
  const ordered = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4051 },
      { stepIdx: 2, price: 4055 },
      { stepIdx: 3, price: 4059 },
    ],
    false,
  )
  assert.deepEqual(ordered.map(c => c.price), [4051, 4055, 4059])
})

test('nextValidRangePendingPrice: buy dump skips too-close shallow rungs', () => {
  // Ask at 4056 → BuyLimits must be ≤ ask - minDistance. stopsLevel=10, point=0.1 → minDist=1
  // 4061 and 4059 are above/too close; 4055 is 1.0 below ask → ok.
  const candidates = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4061 },
      { stepIdx: 2, price: 4059 },
      { stepIdx: 3, price: 4055 },
      { stepIdx: 4, price: 4051 },
    ],
    true,
  )
  const used = new Set<number>()
  const next = nextValidRangePendingPrice({
    candidates,
    usedOrExhaustedStepIdxs: used,
    side: 'buy',
    bid: 4055.5,
    ask: 4056,
    point: 0.1,
    stopsLevel: 10,
    freezeLevel: 0,
  })
  assert.equal(next.candidate?.stepIdx, 3)
  assert.equal(next.candidate?.price, 4055)
  assert.equal(next.reasonSkipped.length, 2)
  assert.equal(next.reasonSkipped[0]?.stepIdx, 1)
  assert.equal(next.reasonSkipped[1]?.stepIdx, 2)
  assert.ok(next.reasonSkipped.every(s => s.reason === 'broker_pending_min_distance'))
})

test('nextValidRangePendingPrice: skips already used steps', () => {
  const candidates = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4055 },
      { stepIdx: 2, price: 4051 },
      { stepIdx: 3, price: 4047 },
    ],
    true,
  )
  const next = nextValidRangePendingPrice({
    candidates,
    usedOrExhaustedStepIdxs: new Set([1]),
    side: 'buy',
    bid: 4058,
    ask: 4059,
    point: 0.1,
    stopsLevel: 10,
    freezeLevel: 0,
  })
  assert.equal(next.candidate?.stepIdx, 2)
  assert.equal(next.reasonSkipped.length, 0)
})

test('nextValidRangePendingPrice: all invalid → null candidate with skips', () => {
  const candidates = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4061 },
      { stepIdx: 2, price: 4059 },
    ],
    true,
  )
  const next = nextValidRangePendingPrice({
    candidates,
    usedOrExhaustedStepIdxs: new Set(),
    side: 'buy',
    bid: 4050,
    ask: 4051,
    point: 0.1,
    stopsLevel: 10,
    freezeLevel: 0,
  })
  assert.equal(next.candidate, null)
  assert.equal(next.reasonSkipped.length, 2)
})

test('nextValidRangePendingPrice: cascading remap keeps distinct deeper prices', () => {
  const candidates = orderRangePendingCandidates(
    [
      { stepIdx: 1, price: 4061 },
      { stepIdx: 2, price: 4059 },
      { stepIdx: 3, price: 4055 },
      { stepIdx: 4, price: 4051 },
      { stepIdx: 5, price: 4047 },
      { stepIdx: 6, price: 4043 },
      { stepIdx: 7, price: 4039 },
      { stepIdx: 8, price: 4035 },
    ],
    true,
  )
  // Ask 4056 → first two invalid; place up to 8 legs onto remaining 6 valid → only 6 places.
  const used = new Set<number>()
  const placed: number[] = []
  for (let leg = 0; leg < 8; leg++) {
    const next = nextValidRangePendingPrice({
      candidates,
      usedOrExhaustedStepIdxs: used,
      side: 'buy',
      bid: 4055.5,
      ask: 4056,
      point: 0.1,
      stopsLevel: 10,
      freezeLevel: 0,
    })
    for (const s of next.reasonSkipped) used.add(s.stepIdx)
    if (!next.candidate) break
    placed.push(next.candidate.stepIdx)
    used.add(next.candidate.stepIdx)
  }
  assert.deepEqual(placed, [3, 4, 5, 6, 7, 8])
  assert.ok(used.has(1) && used.has(2), 'shallow invalid steps exhausted')
})

test('isBrokerPendingLimitPriceRejectMessage: detects price rejects, not invalid stops', () => {
  assert.equal(isBrokerPendingLimitPriceRejectMessage('Invalid price'), true)
  assert.equal(isBrokerPendingLimitPriceRejectMessage('Off quotes'), true)
  assert.equal(isBrokerPendingLimitPriceRejectMessage('Trade is too close to market'), true)
  assert.equal(isBrokerPendingLimitPriceRejectMessage('Invalid stops'), false)
  assert.equal(isBrokerPendingLimitPriceRejectMessage('invalid stops level'), false)
})

test('cancelled invalid-price footprints count as consumed (block ladder re-add)', () => {
  const rows: RangeLegRow[] = [
    { id: 'a', step_idx: 1, status: 'cancelled', stoploss: null, takeprofit: null },
    { id: 'b', step_idx: 2, status: 'cancelled', stoploss: null, takeprofit: null },
    { id: 'c', step_idx: 3, status: 'broker_pending', stoploss: null, takeprofit: null },
  ]
  const consumed = consumedStepIndices(rows)
  assert.ok(consumed.has(1))
  assert.ok(consumed.has(2))
  assert.equal(consumed.has(3), false)
})
