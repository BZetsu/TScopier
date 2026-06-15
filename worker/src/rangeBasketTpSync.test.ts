import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildRangeBasketTpTargets,
  resolveRangeBasketLegCounts,
} from './rangeBasketTpSync'
import type { BasketOpenLeg } from './basketSlTpReconcile'

const TP_LOTS = [
  { label: 'TP1', lot: 0, percent: 50, enabled: true },
  { label: 'TP2', lot: 0, percent: 30, enabled: true },
  { label: 'TP3', lot: 0, percent: 20, enabled: true },
]

function openLeg(id: string, entry: number, openedAt: string): BasketOpenLeg {
  return {
    id,
    signal_id: 'sig',
    metaapi_order_id: '1',
    opened_at: openedAt,
    lot_size: 0.01,
    sl: 4300,
    tp: 4530,
    entry_price: entry,
    direction: 'buy',
    symbol: 'XAUUSD',
  }
}

test('resolveRangeBasketLegCounts: phase B after first range leg', () => {
  const counts = resolveRangeBasketLegCounts({
    openLegCount: 11,
    planImmediateLegCount: 10,
    activePendingCount: 9,
    maxPendingStepIdx: 10,
  })
  assert.equal(counts.firedRangeLegCount, 1)
  assert.equal(counts.phase, 'layering_rebalance')
})

test('buildRangeBasketTpTargets: phase A uses instant pool only', () => {
  const legs = Array.from({ length: 4 }, (_, i) =>
    openLeg(`i${i}`, 4335, `2026-01-01T00:00:0${i}Z`),
  )
  const targets = buildRangeBasketTpTargets({
    familyTrades: legs,
    plan: null,
    parsed: { sl: 4300, tp: [4530, 4510, 4490] },
    tpLots: TP_LOTS,
    direction: 'buy',
    activePendingCount: 6,
    maxPendingStepIdx: 6,
  })
  assert.equal(targets.filter(t => t.takeprofit === 4530).length, 2)
})
