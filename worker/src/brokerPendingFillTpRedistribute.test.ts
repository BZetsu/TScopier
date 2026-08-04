import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRangeBasketTpTargets,
  patchPendingRangeLegTakeProfits,
} from './rangeBasketTpSync'
import type { BasketOpenLeg } from './basketSlTpReconcile'

const TP_LOTS = [
  { label: 'TP1', lot: 0, percent: 50, enabled: true },
  { label: 'TP2', lot: 0, percent: 30, enabled: true },
  { label: 'TP3', lot: 0, percent: 20, enabled: true },
]

function openLeg(id: string, entry: number, openedAt: string, tp = 0): BasketOpenLeg {
  return {
    id,
    signal_id: 'sig-broker',
    metaapi_order_id: id,
    opened_at: openedAt,
    lot_size: 0.01,
    sl: null,
    tp,
    entry_price: entry,
    direction: 'sell',
    symbol: 'XAUUSD',
  }
}

describe('broker pending fill TP% redistribute', () => {
  it('forceLayeringRebalance spreads open legs across TP1/TP2/TP3 by tp_lots %', () => {
    // Simulate fills of naked broker-pending limits becoming open trades.
    const legs = Array.from({ length: 10 }, (_, i) =>
      openLeg(`t${i}`, 4064 - i * 0.03, `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`),
    )
    const targets = buildRangeBasketTpTargets({
      familyTrades: legs,
      plan: null,
      parsed: { sl: 4080, tp: [4061, 4059, 4055] },
      tpLots: TP_LOTS,
      direction: 'sell',
      activePendingCount: 16, // remaining broker_pending
      maxPendingStepIdx: 26,
      forceLayeringRebalance: true,
      stoplossOverride: 4080,
    })
    assert.equal(targets.length, 10)
    assert.ok(targets.every(t => t.stoploss === 4080), 'all legs get signal SL')
    const tpCounts = new Map<number, number>()
    for (const t of targets) {
      tpCounts.set(t.takeprofit, (tpCounts.get(t.takeprofit) ?? 0) + 1)
    }
    // 50/30/20 of 10 → 5 / 3 / 2
    assert.equal(tpCounts.get(4061), 5, 'TP1 ~50%')
    assert.equal(tpCounts.get(4059), 3, 'TP2 ~30%')
    assert.equal(tpCounts.get(4055), 2, 'TP3 ~20%')
  })

  it('patchPendingRangeLegTakeProfits updates broker_pending DB rows (limits stay naked on broker)', async () => {
    const updates: Array<{ id: string; takeprofit: number }> = []
    let statusFilter: string[] | null = null
    const supabase = {
      from(table: string) {
        assert.equal(table, 'range_pending_legs')
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      in(_col: string, statuses: string[]) {
                        statusFilter = statuses
                        return {
                          limit: async () => ({
                            data: [
                              { id: 'bp-1', trigger_price: 4064.9, step_idx: 16 },
                              { id: 'bp-2', trigger_price: 4065.0, step_idx: 17 },
                            ],
                            error: null,
                          }),
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          update(patch: { takeprofit: number }) {
            return {
              eq(_col: string, id: string) {
                updates.push({ id, takeprofit: patch.takeprofit })
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    }

    const openLegs = [
      { id: 'o1', entryPrice: 4064.5, openedAt: '2026-01-01T00:00:00Z' },
      { id: 'o2', entryPrice: 4064.4, openedAt: '2026-01-01T00:00:01Z' },
    ]
    const n = await patchPendingRangeLegTakeProfits({
      supabase: supabase as never,
      brokerAccountId: 'broker-1',
      signalId: 'sig-1',
      isBuy: false,
      finalTps: [4061, 4059, 4055],
      tpLots: TP_LOTS,
      openLegs,
    })
    assert.deepEqual(statusFilter, ['pending', 'claimed', 'broker_pending'])
    assert.equal(n, 2)
    assert.equal(updates.length, 2)
    assert.ok(updates.every(u => u.takeprofit > 0))
  })
})
