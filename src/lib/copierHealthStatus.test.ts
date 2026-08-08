import { describe, expect, it } from 'vitest'
import { copierHealthFromRow } from './copierHealthStatus'

describe('copierHealthStatus', () => {
  it('maps server health row to explicit UI states and timestamp', () => {
    const health = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      last_successful_probe_at: '2026-08-06T10:00:00.000Z',
      updated_at: '2026-08-06T10:00:10.000Z',
      freshness_threshold_ms: 90_000,
      health_reason: 'listener_connected',
    }, { nowMs: new Date('2026-08-06T10:00:20.000Z').getTime() })
    expect(health.telegramAccountStatus).toBe('linked')
    expect(health.signalListenerStatus).toBe('connected')
    expect(health.copierEngineStatus).toBe('operational')
    expect(health.lastSuccessfulHealthAt).toBe('2026-08-06T10:00:00.000Z')
  })

  it('treats missing migration data as unknown rather than live', () => {
    const health = copierHealthFromRow(null)
    expect(health.telegramAccountStatus).toBe('unknown')
    expect(health.signalListenerStatus).toBe('unknown')
    expect(health.copierEngineStatus).toBe('unknown')
  })

  it('rejects invalid or secret-like metadata fields', () => {
    const health = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'live',
      worker_ownership_status: 'owned',
      session_string: 'secret',
    })
    expect(health.copierEngineStatus).toBe('unknown')
    expect(JSON.stringify(health)).not.toContain('secret')
  })

  it('expires stale operational rows when updated_at is old', () => {
    const health = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      last_successful_probe_at: '2026-08-06T10:00:00.000Z',
      updated_at: '2026-08-06T10:00:00.000Z',
      freshness_threshold_ms: 90_000,
    }, { nowMs: new Date('2026-08-06T10:03:00.000Z').getTime() })
    expect(health.copierEngineStatus).toBe('offline')
  })

  it('does not trust operational rows with stale or missing probes', () => {
    const stale = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      last_successful_probe_at: '2026-08-06T10:00:00.000Z',
      updated_at: '2026-08-06T10:02:00.000Z',
      freshness_threshold_ms: 90_000,
    }, { nowMs: new Date('2026-08-06T10:02:00.000Z').getTime() })
    const missing = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      updated_at: '2026-08-06T10:02:00.000Z',
      freshness_threshold_ms: 90_000,
    }, { nowMs: new Date('2026-08-06T10:02:00.000Z').getTime() })
    expect(stale.copierEngineStatus).not.toBe('operational')
    expect(missing.copierEngineStatus).not.toBe('operational')
  })

  it('fails closed for future or malformed timestamps', () => {
    const future = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      last_successful_probe_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
    }, { nowMs: new Date('2026-08-06T10:00:00.000Z').getTime() })
    const malformed = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'connected',
      copier_engine_status: 'operational',
      worker_ownership_status: 'owned',
      mtproto_connected: true,
      last_successful_probe_at: 'not-a-date',
      updated_at: 'not-a-date',
    })
    expect(future.copierEngineStatus).not.toBe('operational')
    expect(malformed.copierEngineStatus).not.toBe('operational')
  })

  it('session row alone can imply linked account wording but never operational engine', () => {
    const health = copierHealthFromRow({
      telegram_account_status: 'linked',
      listener_status: 'unknown',
      copier_engine_status: 'unknown',
      worker_ownership_status: 'unknown',
    })
    expect(health.telegramAccountStatus).toBe('linked')
    expect(health.signalListenerStatus).toBe('unknown')
    expect(health.copierEngineStatus).not.toBe('operational')
  })
})
