import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDesiredLegTargets } from './v2ReconcileMonitor'
import type { FxOpenOrder } from './fxContract'
import type { BasketOpenLeg } from '../basketSlTpReconcile'
import type { DesiredBasket } from './basketStore'

function leg(over: Partial<BasketOpenLeg> = {}): BasketOpenLeg {
  return { id: 'leg', signal_id: 'sig', metaapi_order_id: '100', opened_at: '', lot_size: 0.05, sl: 4065, tp: 4089, entry_price: 4078, direction: 'buy', symbol: 'XAUUSD', auto_be_applied_at: null, ...over }
}
function open(ticket: number, over: Partial<FxOpenOrder> = {}): FxOpenOrder {
  return { ticket, symbol: 'XAUUSD', operation: 'Buy', isBuy: true, volume: 0.05, openPrice: 4078, stopLoss: 4065, takeProfit: 4089, comment: '', magic: 770077, isPending: false, ...over }
}
function desired(over: Partial<DesiredBasket> = {}): DesiredBasket {
  return { brokerAccountId: 'b', anchorSignalId: 'sig', symbol: 'XAUUSD', stoploss: 4090, tpLevels: [4083, 4089], source: 'adjust', instructionAt: '2026-06-24T10:00:00Z', ...over }
}

describe('buildDesiredLegTargets', () => {
  it('applies the desired-state SL to every leg present at the broker', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' }), leg({ id: 'l2', metaapi_order_id: '101' })],
      snapshot: [open(100), open(101)],
      desired: desired({ stoploss: 4090 }),
      isBuy: true,
    })
    assert.equal(t.length, 2)
    assert.ok(t.every(x => x.stoploss === 4090))
  })

  it('keeps the existing broker TP (never repaints a present TP)', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' })],
      snapshot: [open(100, { takeProfit: 4089 })],
      desired: desired({ tpLevels: [4083, 4095] }),
      isBuy: true,
    })
    assert.equal(t[0]!.takeProfit, 4089, 'present TP preserved, not replaced by ladder')
  })

  it('fills a naked leg (no broker TP) with the deepest ladder TP', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' })],
      snapshot: [open(100, { takeProfit: null })],
      desired: desired({ tpLevels: [4083, 4095] }),
      isBuy: true,
    })
    assert.equal(t[0]!.takeProfit, 4095, 'deepest (farthest) TP for a buy')
  })

  it('honors a per-leg auto-breakeven newer than the desired instruction', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100', sl: 4078, auto_be_applied_at: '2026-06-24T11:00:00Z' })],
      snapshot: [open(100, { stopLoss: 4065 })],
      desired: desired({ stoploss: 4090, instructionAt: '2026-06-24T10:00:00Z' }),
      isBuy: true,
    })
    assert.equal(t[0]!.stoploss, 4078, 'newer auto-BE wins over older adjust')
  })

  it('marks an individual vanished leg closed when the snapshot still shows others', () => {
    // computeReconcileActions is covered in reconciler.test; here we assert the builder
    // still returns the present leg so a real partial-close is detectable.
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' }), leg({ id: 'l2', metaapi_order_id: '101' })],
      snapshot: [open(100)],
      desired: desired(),
      isBuy: true,
    })
    assert.equal(t.length, 1)
    assert.equal(t[0]!.ticket, 100)
  })

  it('skips legs not present at the broker (left for closedTickets)', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' }), leg({ id: 'l2', metaapi_order_id: '999' })],
      snapshot: [open(100)],
      desired: desired(),
      isBuy: true,
    })
    assert.equal(t.length, 1)
    assert.equal(t[0]!.ticket, 100)
  })
})
