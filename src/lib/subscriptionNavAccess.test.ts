import { describe, expect, it } from 'vitest'
import { isRouteAllowedWithoutSubscription } from './subscriptionNavAccess'

describe('isRouteAllowedWithoutSubscription', () => {
  it('allows pricing, billing, support, and dashboard', () => {
    expect(isRouteAllowedWithoutSubscription('/pricing')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/billing')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/contact-support')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/dashboard')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/dashboard/broker/abc')).toBe(true)
  })

  it('does not treat other product routes as billing-only paths', () => {
    expect(isRouteAllowedWithoutSubscription('/channels')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/popular-channels')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/affiliate-program')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/brokers')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/backtest')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/performance')).toBe(false)
  })
})
