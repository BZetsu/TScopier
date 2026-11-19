import { describe, expect, it } from 'vitest'
import { buildPublicStatus, probeEffectiveState } from './publicStatus'

const now = new Date('2026-11-19T12:00:00.000Z').getTime()
const fresh = '2026-11-19T11:59:30.000Z'
const stale = '2026-11-19T11:50:00.000Z'

describe('publicStatus', () => {
  it('marks stale probes as unknown, never operational', () => {
    expect(probeEffectiveState({ target: 'worker_trade', state: 'up', updated_at: stale }, now)).toBe('unknown')
    expect(probeEffectiveState({ target: 'worker_trade', state: 'up', updated_at: fresh }, now)).toBe('operational')
  })

  it('builds operational payload with no firing alerts', () => {
    const payload = buildPublicStatus({
      apiOk: true,
      nowMs: now,
      probes: [
        { target: 'worker_trade', state: 'up', updated_at: fresh },
        { target: 'bridge_mt4', state: 'up', updated_at: fresh },
        { target: 'bridge_mt5', state: 'up', updated_at: fresh },
        { target: 'openai_api', state: 'up', updated_at: fresh },
      ],
      firingAlerts: [],
    })
    expect(payload.overall).toBe('operational')
    expect(payload.components.every(c => c.status === 'operational')).toBe(true)
    expect(payload.incidents).toEqual([])
    expect(JSON.stringify(payload)).not.toMatch(/detail|worker_id|sk-/i)
  })

  it('maps trade_workers_offline to outage + safe incident title', () => {
    const payload = buildPublicStatus({
      apiOk: true,
      nowMs: now,
      probes: [{ target: 'worker_trade', state: 'down', updated_at: fresh }],
      firingAlerts: [{
        id: 'evt-1',
        rule_code: 'trade_workers_offline',
        severity: 'critical',
        created_at: fresh,
      }],
    })
    expect(payload.overall).toBe('outage')
    expect(payload.components.find(c => c.id === 'trade_workers')?.status).toBe('outage')
    expect(payload.incidents[0]?.title).toBe('Trade execution disruption')
    expect(payload.incidents[0]?.impact).toBe('major')
    expect(JSON.stringify(payload)).not.toContain('trade_workers_offline')
  })

  it('omits unknown alert rule codes from incidents', () => {
    const payload = buildPublicStatus({
      apiOk: true,
      nowMs: now,
      probes: [],
      firingAlerts: [{
        id: 'evt-2',
        rule_code: 'secret_internal_rule',
        severity: 'warning',
        created_at: fresh,
      }],
    })
    expect(payload.incidents).toEqual([])
  })

  it('marks api outage when probe query failed', () => {
    const payload = buildPublicStatus({
      apiOk: false,
      nowMs: now,
      probes: [],
      firingAlerts: [],
    })
    expect(payload.components.find(c => c.id === 'api')?.status).toBe('outage')
    expect(payload.overall).toBe('outage')
  })
})
