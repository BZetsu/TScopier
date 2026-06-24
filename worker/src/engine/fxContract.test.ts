import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOrderComment,
  classifyOrderResponse,
  DONE_RETCODES,
  isInvalidStopsRetcode,
  MT5_RETCODE,
  normalizeOpenOrder,
  ORDER_NOT_PLACED_RETCODES,
  parseOrderComment,
  retcodeName,
} from './fxContract'

describe('classifyOrderResponse', () => {
  it('accepts a DONE (10009) response with success true', () => {
    const r = classifyOrderResponse({
      success: true, retcode: 10009, retcodeDescription: 'Request completed',
      order: 211438761, deal: 211438760, volume: 0.1, price: 1.15333, bid: 1.15325, ask: 1.15333,
    })
    assert.equal(r.ok, true)
    assert.equal(r.partial, false)
    assert.equal(r.ticket, 211438761)
    assert.equal(r.retcodeName, 'DONE')
  })

  it('accepts a PLACED (10008) pending order', () => {
    const r = classifyOrderResponse({ success: true, retcode: 10008, order: 5 })
    assert.equal(r.ok, true)
    assert.equal(r.ticket, 5)
  })

  it('flags DONE_PARTIAL (10010) as ok + partial', () => {
    const r = classifyOrderResponse({ success: true, retcode: 10010, order: 9, volume: 0.05 })
    assert.equal(r.ok, true)
    assert.equal(r.partial, true)
  })

  it('REJECTS a 200 body whose retcode is a failure even if success is missing', () => {
    // The docs warning: 200 != accepted. retcode 10016 = INVALID_STOPS.
    const r = classifyOrderResponse({ retcode: 10016, retcodeDescription: 'Invalid stops' })
    assert.equal(r.ok, false)
    assert.equal(r.retcodeName, 'INVALID_STOPS')
  })

  it('REJECTS success:false regardless of retcode', () => {
    const r = classifyOrderResponse({ success: false, retcode: 10009 })
    assert.equal(r.ok, false)
  })

  it('REJECTS a body with no retcode at all', () => {
    const r = classifyOrderResponse({ order: 123 })
    assert.equal(r.ok, false)
  })

  it('unwraps a nested result envelope', () => {
    const r = classifyOrderResponse({ result: { success: true, retcode: 10009, order: 77 } })
    assert.equal(r.ok, true)
    assert.equal(r.ticket, 77)
  })

  it('NO_MONEY (10019) is in the not-placed set (safe to abandon, never duplicate)', () => {
    assert.ok(ORDER_NOT_PLACED_RETCODES.has(MT5_RETCODE.NO_MONEY))
    assert.ok(!ORDER_NOT_PLACED_RETCODES.has(MT5_RETCODE.DONE))
  })
})

describe('retcode helpers', () => {
  it('DONE_RETCODES contains DONE and PLACED only', () => {
    assert.ok(DONE_RETCODES.has(10009) && DONE_RETCODES.has(10008))
    assert.ok(!DONE_RETCODES.has(10010))
  })
  it('isInvalidStopsRetcode matches stops/price-off codes', () => {
    assert.equal(isInvalidStopsRetcode(10016), true)
    assert.equal(isInvalidStopsRetcode(10021), true)
    assert.equal(isInvalidStopsRetcode(10009), false)
  })
  it('retcodeName maps known and unknown codes', () => {
    assert.equal(retcodeName(10009), 'DONE')
    assert.equal(retcodeName(99999), 'RETCODE_99999')
    assert.equal(retcodeName(null), 'UNKNOWN')
  })
})

describe('order comment idempotency tag', () => {
  it('builds a bounded, parseable comment', () => {
    const c = buildOrderComment('ae1a0f36-ab01-4380-96fe-0fe5addaeafe', 3)
    assert.ok(c.length <= 31)
    const p = parseOrderComment(c)
    assert.equal(p?.leg, 3)
    assert.equal(p?.anchor, 'ae1a0f36ab014380')
  })
  it('returns null for foreign/blank comments', () => {
    assert.equal(parseOrderComment('manual trade'), null)
    assert.equal(parseOrderComment(''), null)
    assert.equal(parseOrderComment(null), null)
  })
})

describe('normalizeOpenOrder', () => {
  it('normalizes a position row with SL/TP/magic', () => {
    const o = normalizeOpenOrder({
      ticket: 1724738021, symbol: 'XAUUSD', type: 'Buy', volume: 0.09,
      openPrice: 4078.1, stopLoss: 4065, takeProfit: 4089, comment: 't:abc:1', magic: 770077,
    })
    assert.equal(o?.ticket, 1724738021)
    assert.equal(o?.isBuy, true)
    assert.equal(o?.stopLoss, 4065)
    assert.equal(o?.isPending, false)
    assert.equal(o?.magic, 770077)
  })
  it('returns null when no ticket', () => {
    assert.equal(normalizeOpenOrder({ symbol: 'XAUUSD' }), null)
  })
})
