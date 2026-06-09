import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateCopyLimitBreaches,
  equityDelta,
  isChannelCopyLimitPaused,
} from './copyLimitEvaluate'
import { DEFAULT_COPY_LIMITS, pauseKey } from './copyLimitTypes'
import { periodKeyFor } from './copyLimitPeriods'

describe('copyLimitEvaluate', () => {
  it('detects profit target hit when equity gains reach amount target', () => {
    const config = {
      ...DEFAULT_COPY_LIMITS,
      profit_targets_enabled: true,
      profit_targets: [{
        id: 't1',
        enabled: true,
        period: 'daily' as const,
        value_type: 'amount' as const,
        value: 1000,
      }],
    }
    const breaches = evaluateCopyLimitBreaches({
      config,
      state: { paused_period_keys: [], periods: {} },
      equity: {
        currentEquity: 11_000,
        periodStartEquity: 10_000,
        peakEquity: 11_000,
      },
      timeZone: 'UTC',
      at: new Date('2026-06-08T12:00:00Z'),
    })
    assert.equal(breaches.length, 1)
    assert.equal(breaches[0]!.reason, 'channel_profit_target_hit')
    assert.equal(equityDelta({
      currentEquity: 11_000,
      periodStartEquity: 10_000,
      peakEquity: 11_000,
    }), 1000)
  })

  it('detects max loss hit when equity drops by amount limit', () => {
    const config = {
      ...DEFAULT_COPY_LIMITS,
      max_risk_enabled: true,
      max_risks: [{
        id: 'r1',
        enabled: true,
        period: 'daily' as const,
        value_type: 'amount' as const,
        value: 500,
      }],
    }
    const breaches = evaluateCopyLimitBreaches({
      config,
      state: { paused_period_keys: [], periods: {} },
      equity: {
        currentEquity: 9_400,
        periodStartEquity: 10_000,
        peakEquity: 10_200,
      },
      timeZone: 'UTC',
      at: new Date('2026-06-08T12:00:00Z'),
    })
    assert.equal(breaches.length, 1)
    assert.equal(breaches[0]!.reason, 'channel_max_risk_hit')
    assert.equal(breaches[0]!.ruleId, 'r1')
  })

  it('evaluates multiple max risk rules independently', () => {
    const config = {
      ...DEFAULT_COPY_LIMITS,
      max_risk_enabled: true,
      max_risks: [
        {
          id: 'r-daily',
          enabled: true,
          period: 'daily' as const,
          value_type: 'amount' as const,
          value: 50,
        },
        {
          id: 'r-weekly',
          enabled: true,
          period: 'weekly' as const,
          value_type: 'percent' as const,
          value: 5,
        },
      ],
    }
    const breaches = evaluateCopyLimitBreaches({
      config,
      state: { paused_period_keys: [], periods: {} },
      equity: {
        currentEquity: 9_940,
        periodStartEquity: 10_000,
        peakEquity: 10_200,
      },
      timeZone: 'UTC',
      at: new Date('2026-06-08T12:00:00Z'),
    })
    assert.equal(breaches.length, 1)
    assert.equal(breaches[0]!.ruleId, 'r-daily')
  })

  it('detects max risk percent from peak equity drawdown', () => {
    const config = {
      ...DEFAULT_COPY_LIMITS,
      max_risk_enabled: true,
      max_risks: [{
        id: 'r-pct',
        enabled: true,
        period: 'daily' as const,
        value_type: 'percent' as const,
        value: 2,
      }],
    }
    const breaches = evaluateCopyLimitBreaches({
      config,
      state: { paused_period_keys: [], periods: {} },
      equity: {
        currentEquity: 10_500,
        periodStartEquity: 10_000,
        peakEquity: 10_800,
      },
      timeZone: 'UTC',
      at: new Date('2026-06-08T12:00:00Z'),
    })
    assert.equal(breaches.length, 1)
    assert.equal(breaches[0]!.ruleId, 'r-pct')
  })

  it('reports paused when active pause key matches period', () => {
    const at = new Date('2026-06-08T12:00:00Z')
    const pk = periodKeyFor('daily', 'UTC', at)
    const config = {
      ...DEFAULT_COPY_LIMITS,
      profit_targets_enabled: true,
      profit_targets: [{
        id: 't1',
        enabled: true,
        period: 'daily' as const,
        value_type: 'amount' as const,
        value: 50,
      }],
    }
    const pause = isChannelCopyLimitPaused({
      config,
      state: { paused_period_keys: [pauseKey('profit', 'daily', pk, 't1')], periods: {} },
      timeZone: 'UTC',
      at,
    })
    assert.ok(pause)
    assert.equal(pause!.reason, 'channel_profit_target_hit')
  })
})
