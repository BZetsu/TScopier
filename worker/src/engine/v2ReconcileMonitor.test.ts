import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDesiredLegTargets } from './v2ReconcileMonitor'
import type { FxOpenOrder } from './fxContract'
import type { BasketOpenLeg } from '../basketSlTpReconcile'

function leg(over: Partial<BasketOpenLeg> = {}): BasketOpenLeg {
  return { id: 'leg', signal_id: 'sig', metaapi_order_id: '100', opened_at: '', lot_size: 0.05, sl: 4065, tp: 4089, entry_price: 4078, direction: 'buy', symbol: 'XAUUSD', auto_be_applied_at: null, ...over }
}
function open(ticket: number, over: Partial<FxOpenOrder> = {}): FxOpenOrder {
  return { ticket, symbol: 'XAUUSD', operation: 'Buy', isBuy: true, volume: 0.05, openPrice: 4078, stopLoss: 4065, takeProfit: 4089, comment: '', magic: 770077, isPending: false, ...over }
}

describe('buildDesiredLegTargets', () => {
  it('applies the effective basket SL to every leg present at the broker', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' }), leg({ id: 'l2', metaapi_order_id: '101' })],
      snapshot: [open(100), open(101)],
      effectiveSl: 4090,
      effectiveTpLevels: [4083, 4089],
      isBuy: true,
    })
    assert.equal(t.length, 2)
    assert.ok(t.every(x => x.stoploss === 4090))
  })

  it('keeps the existing broker TP (never repaints a present TP)', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' })],
      snapshot: [open(100, { takeProfit: 4089 })],
      effectiveSl: 4090,
      effectiveTpLevels: [4083, 4095],
      isBuy: true,
    })
    assert.equal(t[0]!.takeProfit, 4089, 'present TP preserved, not replaced by ladder')
  })

  it('fills a naked leg (no broker TP) with the deepest ladder TP', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' })],
      snapshot: [open(100, { takeProfit: null })],
      effectiveSl: 4090,
      effectiveTpLevels: [4083, 4095],
      isBuy: true,
    })
    assert.equal(t[0]!.takeProfit, 4095, 'deepest (farthest) TP for a buy')
  })

  it('enforces SL on a naked leg (broker SL missing) using the effective SL', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100', sl: 0 })],
      snapshot: [open(100, { stopLoss: null })],
      effectiveSl: 3970,
      effectiveTpLevels: [4005, 4010, 4015],
      isBuy: true,
    })
    assert.equal(t[0]!.stoploss, 3970, 'naked broker leg gets the effective SL')
  })

  it('preserves a more-protective per-leg auto-breakeven (never loosens a BE leg)', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100', sl: 4078, auto_be_applied_at: '2026-06-24T11:00:00Z' })],
      snapshot: [open(100, { stopLoss: 4078 })],
      effectiveSl: 4065, // looser than the BE 4078 for a buy
      effectiveTpLevels: [4089],
      isBuy: true,
    })
    assert.equal(t[0]!.stoploss, 4078, 'BE SL kept; not loosened to 4065')
  })

  it('skips legs not present at the broker (left for closedTickets)', () => {
    const t = buildDesiredLegTargets({
      legs: [leg({ metaapi_order_id: '100' }), leg({ id: 'l2', metaapi_order_id: '999' })],
      snapshot: [open(100)],
      effectiveSl: 4090,
      effectiveTpLevels: [],
      isBuy: true,
    })
    assert.equal(t.length, 1)
    assert.equal(t[0]!.ticket, 100)
  })
})
