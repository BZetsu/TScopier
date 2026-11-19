import { describe, expect, it } from 'vitest'
import { copierHealthFromRow } from './copierHealthStatus'
import {
  deriveCopierHealthUi,
  shouldShowCopierHealthBanner,
} from './copierHealthUi'

const baseLive = {
  telegram_account_status: 'linked',
  listener_status: 'connected',
  copier_engine_status: 'operational',
  worker_ownership_status: 'owned',
  mtproto_connected: true,
  last_successful_probe_at: '2026-11-19T12:00:00.000Z',
  updated_at: '2026-11-19T12:00:05.000Z',
  freshness_threshold_ms: 90_000,
}

describe('copierHealthUi', () => {
  it('treats mtproto down as linked_not_receiving (not Connected)', () => {
    const health = copierHealthFromRow({
      ...baseLive,
      mtproto_connected: false,
      copier_engine_status: 'offline',
      listener_status: 'connected',
    }, { nowMs: new Date('2026-11-19T12:00:10.000Z').getTime() })
    const ui = deriveCopierHealthUi(health, { hasTelegramSession: true })
    expect(ui.telegramLive).toBe(false)
    expect(ui.linkedNotReceiving).toBe(true)
    expect(ui.bannerKind).toBe('linked_not_receiving')
    expect(shouldShowCopierHealthBanner(health, {
      hasTelegramSession: true,
      hasActiveSubscription: true,
    })).toBe(true)
  })

  it('hides banner when health is operational', () => {
    const health = copierHealthFromRow(baseLive, {
      nowMs: new Date('2026-11-19T12:00:10.000Z').getTime(),
    })
    const ui = deriveCopierHealthUi(health, { hasTelegramSession: true })
    expect(ui.telegramLive).toBe(true)
    expect(ui.bannerKind).toBe('none')
    expect(shouldShowCopierHealthBanner(health, {
      hasTelegramSession: true,
      hasActiveSubscription: true,
    })).toBe(false)
  })

  it('shows reconnect_required over linked_not_receiving', () => {
    const health = copierHealthFromRow({
      ...baseLive,
      telegram_account_status: 'reconnect_required',
      mtproto_connected: false,
      copier_engine_status: 'stopped',
      listener_status: 'failed',
    }, { nowMs: new Date('2026-11-19T12:00:10.000Z').getTime() })
    const ui = deriveCopierHealthUi(health, { hasTelegramSession: true })
    expect(ui.bannerKind).toBe('reconnect_required')
    expect(shouldShowCopierHealthBanner(health, {
      hasTelegramSession: true,
      hasActiveSubscription: true,
    })).toBe(true)
  })

  it('does not show banner without subscription or session', () => {
    const health = copierHealthFromRow({
      ...baseLive,
      mtproto_connected: false,
      copier_engine_status: 'offline',
    }, { nowMs: new Date('2026-11-19T12:00:10.000Z').getTime() })
    expect(shouldShowCopierHealthBanner(health, {
      hasTelegramSession: false,
      hasActiveSubscription: true,
    })).toBe(false)
    expect(shouldShowCopierHealthBanner(health, {
      hasTelegramSession: true,
      hasActiveSubscription: false,
    })).toBe(false)
  })
})
