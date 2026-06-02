import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMENTARY_NOT_SIGNAL_REASON,
  ENTRY_MISSING_STRUCTURE_REASON,
  evaluateParsedSignalExecutionEligibility,
} from './signalExecutionEligibility'

describe('evaluateParsedSignalExecutionEligibility', () => {
  it('rejects commentary-style pip/TP chatter', () => {
    const eligibility = evaluateParsedSignalExecutionEligibility({
      action: 'sell',
      symbol: 'XAUUSD',
      sl: null,
      tp: [2],
    }, 'Hmmmm 6 pips short of TP2.... Funny you gold.')
    assert.equal(eligibility.eligible, false)
    assert.equal(eligibility.skipReason, COMMENTARY_NOT_SIGNAL_REASON)
  })

  it('accepts minimal market entry with symbol and side intent', () => {
    const eligibility = evaluateParsedSignalExecutionEligibility({
      action: 'buy',
      symbol: 'XAUUSD',
      sl: null,
      tp: [],
    }, 'Gold buy now')
    assert.equal(eligibility.eligible, true)
  })

  it('accepts structured entry signal', () => {
    const eligibility = evaluateParsedSignalExecutionEligibility({
      action: 'sell',
      symbol: 'XAUUSD',
      sl: 4577,
      tp: [4564, 4527],
      entry_price: 4567,
    }, 'Gold sell now @ 4567 TP1: 4564 TP2: 4527 SL: 4577')
    assert.equal(eligibility.eligible, true)
  })

  it('rejects entry lacking structure and market intent', () => {
    const eligibility = evaluateParsedSignalExecutionEligibility({
      action: 'sell',
      symbol: 'XAUUSD',
      sl: null,
      tp: [],
    }, 'Gold maybe going down')
    assert.equal(eligibility.eligible, false)
    assert.equal(eligibility.skipReason, ENTRY_MISSING_STRUCTURE_REASON)
  })
})
