import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  clearPendingPlanSelection,
  loadPendingPlanSelection,
  parsePlanSelectionFromSearch,
  postAuthAppPath,
  signupUrlWithPlan,
  stashPendingPlanSelection,
} from './pendingPlanSelection'

describe('pendingPlanSelection', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    sessionStorage.clear()
  })

  it('parses plan query params', () => {
    expect(parsePlanSelectionFromSearch('?plan=advanced&interval=annual&extraAccounts=3')).toEqual({
      plan: 'advanced',
      interval: 'annual',
      extraAccounts: 3,
    })
    expect(parsePlanSelectionFromSearch('?plan=basic')).toEqual({
      plan: 'basic',
      interval: 'monthly',
      extraAccounts: 0,
    })
    expect(parsePlanSelectionFromSearch('')).toBeNull()
  })

  it('stashes and loads from sessionStorage', () => {
    stashPendingPlanSelection({ plan: 'advanced', interval: 'monthly', extraAccounts: 2 })
    expect(loadPendingPlanSelection()).toEqual({
      plan: 'advanced',
      interval: 'monthly',
      extraAccounts: 2,
    })
    clearPendingPlanSelection()
    expect(loadPendingPlanSelection()).toBeNull()
  })

  it('builds signup URL and post-auth pricing path', () => {
    expect(signupUrlWithPlan({ plan: 'basic', interval: 'monthly', extraAccounts: 0 }, 'ABC')).toBe(
      '/signup?plan=basic&interval=monthly&ref=ABC',
    )
    stashPendingPlanSelection({ plan: 'advanced', interval: 'monthly', extraAccounts: 0 })
    expect(postAuthAppPath()).toMatch(/^\/pricing\?startCheckout=1/)
    clearPendingPlanSelection()
    expect(postAuthAppPath()).toMatch(/^\/dashboard/)
  })
})
