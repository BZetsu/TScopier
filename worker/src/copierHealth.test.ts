import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, beforeEach } from 'node:test'
import {
  copierHealthOfflineGraceMs,
  maybeCaptureCopierOffline,
  persistCopierHealth,
  resetCopierHealthForTests,
  resolveCopierEngineState,
} from './copierHealth'
import {
  initWorkerSentry,
  resetWorkerSentryForTests,
  setSentryAdapterForTests,
} from './observability/sentry'
import { resetBusinessEventsForTests } from './observability/businessEvents'

class MockScope {
  level: string | null = null
  tags: Record<string, string> = {}
  contexts: Record<string, unknown> = {}
  extras: Record<string, unknown> = {}
  fingerprint: string[] | null = null
  setLevel(level: string): void { this.level = level }
  setTag(key: string, value: string): void { this.tags[key] = value }
  setContext(key: string, value: unknown): void { this.contexts[key] = value }
  setExtra(key: string, value: unknown): void { this.extras[key] = value }
  setFingerprint(value: string[]): void { this.fingerprint = value }
}

function mockSentry() {
  const mock = {
    capturedMessages: [] as unknown[],
    scopes: [] as MockScope[],
    captureMessage(msg: string, level?: string) {
      mock.capturedMessages.push({ msg, level })
      return 'event-id'
    },
    init() {},
    captureException() { return 'event-id' },
    addBreadcrumb() {},
    setTag() {},
    setContext() {},
    withScope(fn: (scope: MockScope) => void) {
      const scope = new MockScope()
      mock.scopes.push(scope)
      fn(scope)
    },
    async flush() { return true },
  }
  return mock
}

function setupSentry() {
  resetWorkerSentryForTests()
  resetBusinessEventsForTests()
  const mock = mockSentry()
  setSentryAdapterForTests(mock as never)
  initWorkerSentry({
    SENTRY_ENABLED: 'true',
    SENTRY_DSN: 'https://public@example.invalid/1',
  } as NodeJS.ProcessEnv)
  return mock
}

describe('copier health model', () => {
  beforeEach(() => {
    resetCopierHealthForTests()
    resetBusinessEventsForTests()
    resetWorkerSentryForTests()
    delete process.env.COPIER_HEALTH_OFFLINE_GRACE_MS
    delete process.env.SENTRY_BUSINESS_EVENT_COOLDOWN_MS
  })

  it('fresh lease plus disconnected listener is degraded within grace, not operational', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'disconnected',
      owned: true,
      lastSuccessfulProbeAt: 1_000,
      nowMs: 30_000,
      offlineGraceMs: 60_000,
    })
    assert.equal(state.copierEngineStatus, 'degraded')
    assert.equal(state.telegramAccountStatus, 'linked')
  })

  it('session row without active listener is offline, not online', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'unknown',
      owned: false,
      nowMs: 120_000,
      offlineGraceMs: 60_000,
    })
    assert.equal(state.copierEngineStatus, 'offline')
    assert.equal(state.workerOwnershipStatus, 'unowned')
  })

  it('connected listener with ownership and fresh probe is operational', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'connected',
      owned: true,
      mtprotoConnected: true,
      lastSuccessfulProbeAt: 10_000,
      nowMs: 20_000,
      freshnessThresholdMs: 90_000,
    })
    assert.equal(state.copierEngineStatus, 'operational')
  })

  it('connected listener with stale probe is not operational', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'connected',
      owned: true,
      mtprotoConnected: true,
      lastSuccessfulProbeAt: 1_000,
      nowMs: 200_000,
      offlineGraceMs: 60_000,
      freshnessThresholdMs: 90_000,
    })
    assert.equal(state.copierEngineStatus, 'offline')
  })

  it('connected listener without a probe is degraded, not operational', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'connected',
      owned: true,
      mtprotoConnected: true,
      nowMs: 20_000,
      freshnessThresholdMs: 90_000,
    })
    assert.equal(state.copierEngineStatus, 'degraded')
  })

  it('lease renewal alone does not refresh probe freshness', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'connected',
      owned: true,
      mtprotoConnected: true,
      lastSuccessfulProbeAt: 1_000,
      nowMs: 200_000,
      offlineGraceMs: 60_000,
      freshnessThresholdMs: 90_000,
    })
    assert.notEqual(state.copierEngineStatus, 'operational')
  })

  it('disconnect beyond grace is offline', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'disconnected',
      owned: true,
      lastSuccessfulProbeAt: 1_000,
      nowMs: 122_000,
      offlineGraceMs: 60_000,
    })
    assert.equal(state.copierEngineStatus, 'offline')
  })

  it('recovery exhaustion requires reconnect and stops copier', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'failed',
      owned: true,
      recoveryExhausted: true,
    })
    assert.equal(state.telegramAccountStatus, 'reconnect_required')
    assert.equal(state.copierEngineStatus, 'stopped')
  })

  it('user-disabled copying is stopped, not offline', () => {
    const state = resolveCopierEngineState({
      linked: true,
      listenerStatus: 'disconnected',
      owned: false,
      copierPaused: true,
    })
    assert.equal(state.copierEngineStatus, 'stopped')
  })

  it('invalid grace value falls back safely', () => {
    process.env.COPIER_HEALTH_OFFLINE_GRACE_MS = 'bad'
    assert.equal(copierHealthOfflineGraceMs(), 60_000)
  })

  it('health persistence failures do not throw', async () => {
    const supabase = { rpc: async () => { throw new Error('db down') } }
    await assert.doesNotReject(() => persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
    }, { ownershipEpoch: '2026-08-06T12:00:00.000Z' }))
  })

  it('unchanged health writes are bounded', async () => {
    const rows: unknown[] = []
    const supabase = { rpc: async (_fn: string, row: unknown) => { rows.push(row); return { data: true, error: null } } }
    const patch = {
      telegramAccountStatus: 'linked' as const,
      listenerStatus: 'connected' as const,
      copierEngineStatus: 'operational' as const,
      workerOwnershipStatus: 'owned' as const,
    }
    await persistCopierHealth(supabase as never, 'user-a', patch, { nowMs: 1_000, ownershipEpoch: '2026-08-06T12:00:00.000Z' })
    await persistCopierHealth(supabase as never, 'user-a', patch, { nowMs: 2_000, ownershipEpoch: '2026-08-06T12:00:00.000Z' })
    await persistCopierHealth(supabase as never, 'user-a', patch, { nowMs: 32_000, ownershipEpoch: '2026-08-06T12:00:00.000Z' })
    assert.equal(rows.length, 2)
  })

  it('stale ownership rejection is non-fatal', async () => {
    const supabase = { rpc: async () => ({ data: false, error: null }) }
    const result = await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
    }, { ownershipEpoch: '2026-08-06T12:00:00.000Z', force: true })
    assert.equal(result, 'stale_ownership')
  })

  it('same owner newer update succeeds through guarded RPC', async () => {
    const calls: unknown[] = []
    const supabase = { rpc: async (_fn: string, params: unknown) => { calls.push(params); return { data: true, error: null } } }
    const result = await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
      mtprotoConnected: true,
    }, { ownershipEpoch: '2026-08-06T12:00:00.000Z', force: true, nowMs: 10_000 })
    assert.equal(result, 'written')
    assert.equal(calls.length, 1)
  })

  it('owned health writes require a current lease and carry ownership epoch', async () => {
    const calls: Array<Record<string, unknown>> = []
    const supabase = { rpc: async (_fn: string, params: Record<string, unknown>) => { calls.push(params); return { data: true, error: null } } }
    await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
      mtprotoConnected: true,
    }, {
      ownershipEpoch: '2026-08-06T12:00:00.000Z',
      leaseAcquiredAt: '2026-08-06T12:00:00.000Z',
      force: true,
    })
    assert.equal(calls[0]?.p_require_lease, true)
    assert.equal(calls[0]?.p_allow_without_lease, false)
    assert.equal(calls[0]?.p_ownership_epoch, '2026-08-06T12:00:00.000Z')
    assert.equal(calls[0]?.p_lease_acquired_at, '2026-08-06T12:00:00.000Z')
  })

  it('post-release terminal health writes are explicitly lease-optional', async () => {
    const calls: Array<Record<string, unknown>> = []
    const supabase = { rpc: async (_fn: string, params: Record<string, unknown>) => { calls.push(params); return { data: true, error: null } } }
    await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'not_linked',
      listenerStatus: 'disconnected',
      copierEngineStatus: 'stopped',
      workerOwnershipStatus: 'unowned',
    }, { allowWithoutLease: true, force: true })
    assert.equal(calls[0]?.p_require_lease, false)
    assert.equal(calls[0]?.p_allow_without_lease, true)
  })

  it('concurrent ownership race leaves one authoritative writer', async () => {
    let ownerOpen = true
    const accepted: string[] = []
    const supabase = {
      rpc: async (_fn: string, params: { p_expected_worker_id: string }) => {
        if (!ownerOpen) return { data: false, error: null }
        accepted.push(params.p_expected_worker_id)
        ownerOpen = false
        return { data: true, error: null }
      },
    }
    await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
    }, { ownershipEpoch: '2026-08-06T12:00:00.000Z', force: true })
    await persistCopierHealth(supabase as never, 'user-a', {
      telegramAccountStatus: 'linked',
      listenerStatus: 'connected',
      copierEngineStatus: 'operational',
      workerOwnershipStatus: 'owned',
    }, { ownershipEpoch: '2026-08-06T12:00:00.000Z', force: true })
    assert.equal(accepted.length, 1)
  })

  it('migration keeps copier health writes service-role-only and ownership guarded', () => {
    const sql = readFileSync('../supabase/migrations/20260806120000_copier_listener_health.sql', 'utf8')
    assert.match(sql, /ALTER TABLE public\.copier_listener_health ENABLE ROW LEVEL SECURITY/i)
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.upsert_copier_listener_health/i)
    assert.match(sql, /SECURITY DEFINER\s+SET search_path = public, pg_catalog/i)
    assert.match(sql, /p_ownership_epoch timestamptz/i)
    assert.match(sql, /p_require_lease AND NOT has_current_owner/i)
    assert.match(sql, /current_lease_worker_id <> p_expected_worker_id/i)
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.upsert_copier_listener_health/i)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.upsert_copier_listener_health[\s\S]*TO service_role/i)
    assert.doesNotMatch(sql, /session_string/i)
  })

  it('does not emit an offline issue within grace', () => {
    const mock = setupSentry()
    maybeCaptureCopierOffline({
      userId: 'user-a',
      listenerStatus: 'disconnected',
      reasonCode: 'LISTENER_DISCONNECTED',
      reason: 'listener_disconnected',
      sinceMs: Date.now(),
    })
    assert.equal(mock.capturedMessages.length, 0)
  })

  it('emits copier offline after grace and cooldown-limits repeats', () => {
    const mock = setupSentry()
    maybeCaptureCopierOffline({
      userId: 'user-a',
      listenerStatus: 'disconnected',
      reasonCode: 'LISTENER_DISCONNECTED',
      reason: 'listener_disconnected',
      sinceMs: Date.now() - 120_000,
    })
    maybeCaptureCopierOffline({
      userId: 'user-b',
      listenerStatus: 'disconnected',
      reasonCode: 'LISTENER_DISCONNECTED',
      reason: 'listener_disconnected',
      sinceMs: Date.now() - 120_000,
    })
    assert.equal(mock.capturedMessages.length, 1)
    assert.equal(mock.scopes[0]?.tags.event_name, 'copier_engine_offline')
  })

  it('manual-review health events remain visible', () => {
    const mock = setupSentry()
    maybeCaptureCopierOffline({
      userId: 'user-a',
      listenerStatus: 'failed',
      reasonCode: 'TELEGRAM_RECONNECT_EXHAUSTED',
      reason: 'reconnect_exhausted',
      manualReview: true,
    })
    maybeCaptureCopierOffline({
      userId: 'user-b',
      listenerStatus: 'failed',
      reasonCode: 'TELEGRAM_RECONNECT_EXHAUSTED',
      reason: 'reconnect_exhausted',
      manualReview: true,
    })
    assert.equal(mock.capturedMessages.length, 2)
    assert.equal(mock.scopes[0]?.tags.event_name, 'telegram_listener_failed')
  })
})
