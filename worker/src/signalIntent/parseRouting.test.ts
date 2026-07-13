import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CHANNEL_KEYWORDS } from '../parseSignal'
import { deterministicQualifiesForFastPath } from './universalSignalParser'

describe('deterministicQualifiesForFastPath', () => {
  it('accepts high-confidence eligible structured entry', () => {
    const msg = `GOLD BUY NOW
Entry 2650
SL 2640
TP 2660`
    const det = {
      status: 'parsed' as const,
      skip_reason: null,
      parsed: {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: 2650,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: 2640,
        tp: [2660],
        lot_size: null,
        confidence: 0.99,
        raw_instruction: msg,
      },
    }
    assert.equal(
      deterministicQualifiesForFastPath(det, msg, DEFAULT_CHANNEL_KEYWORDS),
      true,
    )
  })

  it('rejects low-confidence deterministic parse', () => {
    const msg = 'maybe gold'
    const det = {
      status: 'parsed' as const,
      skip_reason: null,
      parsed: {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: 2650,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: null,
        tp: [],
        lot_size: null,
        confidence: 0.5,
        raw_instruction: msg,
      },
    }
    assert.equal(
      deterministicQualifiesForFastPath(det, msg, DEFAULT_CHANNEL_KEYWORDS),
      false,
    )
  })
})
