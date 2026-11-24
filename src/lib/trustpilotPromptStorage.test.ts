/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTrustpilotPromptDone,
  markTrustpilotPromptDone,
  shouldShowTrustpilotPrompt,
  snoozeTrustpilotPrompt,
} from './trustpilotPromptStorage'

describe('trustpilotPromptStorage', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('shows on first visit', () => {
    expect(shouldShowTrustpilotPrompt()).toBe(true)
  })

  it('never shows after Rate (done)', () => {
    markTrustpilotPromptDone()
    expect(isTrustpilotPromptDone()).toBe(true)
    expect(shouldShowTrustpilotPrompt()).toBe(false)
  })

  it('hides for the same session after remind later', () => {
    snoozeTrustpilotPrompt()
    expect(shouldShowTrustpilotPrompt()).toBe(false)
  })

  it('shows again on a new session before 7 days', () => {
    snoozeTrustpilotPrompt()
    window.sessionStorage.clear()
    expect(shouldShowTrustpilotPrompt()).toBe(true)
  })

  it('shows again after 7 days in the same session', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
    snoozeTrustpilotPrompt()
    expect(shouldShowTrustpilotPrompt()).toBe(false)
    vi.setSystemTime(new Date('2026-12-02T12:00:00Z'))
    expect(shouldShowTrustpilotPrompt()).toBe(true)
  })
})
