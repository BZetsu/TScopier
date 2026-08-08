import { describe, expect, it } from 'vitest'
import { isRouteAllowedWithoutSubscription } from './subscriptionNavAccess'

describe('isRouteAllowedWithoutSubscription', () => {
  it('allows pricing, billing, and support only', () => {
    expect(isRouteAllowedWithoutSubscription('/pricing')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/billing')).toBe(true)
    expect(isRouteAllowedWithoutSubscription('/contact-support')).toBe(true)
  })

  it('blocks dashboard explore and other product routes', () => {
    expect(isRouteAllowedWithoutSubscription('/dashboard')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/dashboard/broker/abc')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/channels')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/popular-channels')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/affiliate-program')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/brokers')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/backtest')).toBe(false)
    expect(isRouteAllowedWithoutSubscription('/performance')).toBe(false)
  })
})
