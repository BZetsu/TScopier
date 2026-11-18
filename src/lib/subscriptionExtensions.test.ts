import { describe, expect, it } from 'vitest'
import {
  grantEndMs,
  grantStartMs,
  isExtensionActive,
  latestExtensionEndMs,
  pendingExtensionStartMs,
  subscriptionEndMs,
} from './subscriptionExtensions'

const DAY = 86_400_000

describe('grantEndMs', () => {
  it('ends a grant seven days after it was granted', () => {
    const end = grantEndMs({ days: 7, granted_at: '2026-11-01T00:00:00.000Z' })
    expect(end).toBe(Date.parse('2026-11-01T00:00:00.000Z') + 7 * DAY)
  })

  it('rejects unusable rows', () => {
    expect(grantEndMs({ days: 0, granted_at: '2026-11-01T00:00:00.000Z' })).toBeNull()
    expect(grantEndMs({ days: 7, granted_at: 'not-a-date' })).toBeNull()
    expect(grantEndMs({ days: Number.NaN, granted_at: '2026-11-01T00:00:00.000Z' })).toBeNull()
  })
})

describe('latestExtensionEndMs', () => {
  it('returns null when there are no grants', () => {
    expect(latestExtensionEndMs(null)).toBeNull()
    expect(latestExtensionEndMs([])).toBeNull()
    expect(latestExtensionEndMs(undefined)).toBeNull()
  })

  it('returns the latest end across grants', () => {
    const latest = latestExtensionEndMs([
      { days: 3, granted_at: '2026-11-01T00:00:00.000Z' },
      { days: 14, granted_at: '2026-11-10T00:00:00.000Z' },
      { days: 7, granted_at: '2026-10-01T00:00:00.000Z' },
    ])
    expect(latest).toBe(Date.parse('2026-11-10T00:00:00.000Z') + 14 * DAY)
  })

  it('ignores unusable rows', () => {
    const latest = latestExtensionEndMs([
      { days: 7, granted_at: 'not-a-date' },
      { days: 3, granted_at: '2026-11-01T00:00:00.000Z' },
    ])
    expect(latest).toBe(Date.parse('2026-11-01T00:00:00.000Z') + 3 * DAY)
  })
})

describe('isExtensionActive', () => {
  it('is active only while the window is open', () => {
    expect(isExtensionActive(null)).toBe(false)
    expect(isExtensionActive(Date.now() + 60_000)).toBe(true)
    expect(isExtensionActive(Date.now() - 60_000)).toBe(false)
  })

  it('treats the exact end moment as expired', () => {
    const now = Date.parse('2026-11-21T00:00:00.000Z')
    expect(isExtensionActive(now, now)).toBe(false)
    expect(isExtensionActive(now + 1, now)).toBe(true)
  })
})

describe('grant window anchoring (incident 2026-11-18 follow-up)', () => {
  // A fixed "now" keeps the matrix readable.
  const NOW = Date.parse('2026-11-18T12:00:00.000Z')
  const daysFrom = (n: number) => new Date(NOW + n * DAY).toISOString()

  describe('subscriptionEndMs', () => {
    it('reads the paid period end regardless of status', () => {
      // Stripe flips to canceled and keeps current_period_end; discarding it there
      // made a grant expire unused on the ordinary cancellation path.
      expect(subscriptionEndMs({ status: 'canceled', current_period_end: daysFrom(10) }))
        .toBe(NOW + 10 * DAY)
      expect(subscriptionEndMs({ status: 'active', current_period_end: daysFrom(10) }))
        .toBe(NOW + 10 * DAY)
      expect(subscriptionEndMs({ status: 'past_due', current_period_end: daysFrom(10) }))
        .toBe(NOW + 10 * DAY)
    })

    it('falls back to the trial end, then to null', () => {
      expect(subscriptionEndMs({ status: 'trialing', trial_ends_at: daysFrom(3) })).toBe(NOW + 3 * DAY)
      expect(subscriptionEndMs({ status: 'incomplete' })).toBeNull()
      expect(subscriptionEndMs(null)).toBeNull()
    })
  })

  describe('grantStartMs', () => {
    const grant = { days: 7, granted_at: daysFrom(0) }

    it('queues the window behind a running paid period', () => {
      expect(grantStartMs(grant, { status: 'active', current_period_end: daysFrom(10) }, NOW))
        .toBe(NOW + 10 * DAY)
    })

    it('starts at the period end once the period is over, not at granted_at', () => {
      // Granted while paying, cancelled days later: the grant must still pay out.
      const grantedLastWeek = { days: 7, granted_at: daysFrom(-7) }
      const endedYesterday = daysFrom(-1)
      expect(grantStartMs(grantedLastWeek, { status: 'canceled', current_period_end: endedYesterday }, NOW))
        .toBe(NOW - DAY)
    })

    it('starts at the grant date when there is no subscription', () => {
      expect(grantStartMs(grant, null, NOW)).toBe(NOW)
    })

    it('clamps a paid-through-but-not-running end to now', () => {
      expect(grantStartMs(grant, { status: 'canceled', current_period_end: daysFrom(5) }, NOW)).toBe(NOW)
    })
  })

  describe('latestExtensionEndMs with a subscription', () => {
    it('ignores a queued window, so a paying Basic customer never shows Advanced', () => {
      const granted = [{ days: 7, granted_at: daysFrom(0) }]
      expect(latestExtensionEndMs(granted, { status: 'active', plan: 'basic', current_period_end: daysFrom(10) }, NOW))
        .toBeNull()
    })

    it('counts a window that has started', () => {
      const granted = [{ days: 7, granted_at: daysFrom(-7) }]
      expect(latestExtensionEndMs(granted, { status: 'canceled', current_period_end: daysFrom(-1) }, NOW))
        .toBe(NOW + 6 * DAY)
    })

    it('exposes the queued start for display', () => {
      const granted = [{ days: 7, granted_at: daysFrom(0) }]
      expect(pendingExtensionStartMs(granted, { status: 'active', current_period_end: daysFrom(10) }, NOW))
        .toBe(NOW + 10 * DAY)
      expect(pendingExtensionStartMs(granted, null, NOW)).toBeNull()
    })

    it('reports an already-elapsed window as inactive', () => {
      // Granted 30 days ago, paid period ended 20 days ago, 7-day grant: long gone.
      const granted = [{ days: 7, granted_at: daysFrom(-30) }]
      const end = latestExtensionEndMs(granted, { status: 'canceled', current_period_end: daysFrom(-20) }, NOW)
      // The anchor is the period end (-20d), so the window ran -20d..-13d.
      expect(end).toBe(NOW - 13 * DAY)
      expect(isExtensionActive(end, NOW)).toBe(false)
    })
  })
})
