import { describe, it, expect } from 'vitest'
import {
  HUMAN_REVIEW_WINDOW_MS,
  isHumanReviewSignal,
  reviewParsedLevels,
  reviewRemainingMs,
} from './humanReview'

describe('isHumanReviewSignal', () => {
  it('accepts skipped signals with the review skip reason', () => {
    expect(isHumanReviewSignal({
      status: 'skipped',
      skip_reason: 'AI classified as uncertain; human review required',
    })).toBe(true)
  })

  it('rejects executed signals', () => {
    expect(isHumanReviewSignal({
      status: 'executed',
      skip_reason: 'AI classified as uncertain; human review required',
    })).toBe(false)
  })

  it('rejects other skip reasons', () => {
    expect(isHumanReviewSignal({ status: 'skipped', skip_reason: 'entry_zone_far_from_market' })).toBe(false)
  })

  it('rejects null skip reason', () => {
    expect(isHumanReviewSignal({ status: 'skipped', skip_reason: null })).toBe(false)
  })
})

describe('reviewRemainingMs', () => {
  it('returns the full window for a fresh signal', () => {
    const now = Date.now()
    const createdAt = new Date(now).toISOString()
    const remaining = reviewRemainingMs(createdAt, now)
    expect(remaining).toBeGreaterThan(HUMAN_REVIEW_WINDOW_MS - 1000)
    expect(remaining).toBeLessThanOrEqual(HUMAN_REVIEW_WINDOW_MS)
  })

  it('returns 0 for an expired signal', () => {
    const createdAt = new Date(Date.now() - HUMAN_REVIEW_WINDOW_MS - 1000).toISOString()
    expect(reviewRemainingMs(createdAt)).toBe(0)
  })

  it('returns 0 for a missing timestamp', () => {
    expect(reviewRemainingMs(undefined)).toBe(0)
  })
})

describe('reviewParsedLevels', () => {
  it('maps parsed data to display levels', () => {
    const signal = {
      parsed_data: {
        action: 'sell',
        symbol: 'XAUUSD',
        entry_price: 4276,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: null,
        tp: [30],
      },
    }
    expect(reviewParsedLevels(signal as never)).toEqual({
      action: 'sell',
      symbol: 'XAUUSD',
      entry: '4276',
      sl: null,
      tp: '30',
    })
  })

  it('maps entry zones', () => {
    const signal = {
      parsed_data: {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: null,
        entry_zone_low: 2650,
        entry_zone_high: 2655,
        sl: 2665,
        tp: [2640, 2635],
      },
    }
    expect(reviewParsedLevels(signal as never)).toEqual({
      action: 'buy',
      symbol: 'XAUUSD',
      entry: '2650 – 2655',
      sl: '2665',
      tp: '2640, 2635',
    })
  })

  it('handles empty parsed data', () => {
    expect(reviewParsedLevels({ parsed_data: null } as never)).toEqual({
      action: null,
      symbol: null,
      entry: null,
      sl: null,
      tp: null,
    })
  })
})
