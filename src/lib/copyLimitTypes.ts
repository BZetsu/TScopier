export type CopyLimitPeriod = 'daily' | 'weekly' | 'monthly' | 'overall'
export type CopyLimitValueType = 'amount' | 'percent'
export type CopyLimitTimezoneMode = 'profile' | 'custom'

export interface ProfitTargetRule {
  id: string
  enabled: boolean
  period: CopyLimitPeriod
  value_type: CopyLimitValueType
  value: number
}

export interface MaxRiskRule {
  period: CopyLimitPeriod
  value_type: CopyLimitValueType
  value: number
}

export interface CopyLimitsConfig {
  profit_targets_enabled: boolean
  profit_targets: ProfitTargetRule[]
  max_risk_enabled: boolean
  max_risk?: MaxRiskRule
  timezone_mode: CopyLimitTimezoneMode
  timezone?: string
}

export interface CopyLimitPeriodSnapshot {
  period_key: string
  reference_equity: number
  peak_channel_pnl: number
  last_evaluated_at: string
}

export interface CopyLimitState {
  paused_period_keys: string[]
  periods: Record<string, CopyLimitPeriodSnapshot>
}

export const DEFAULT_COPY_LIMITS: CopyLimitsConfig = {
  profit_targets_enabled: false,
  profit_targets: [],
  max_risk_enabled: false,
  timezone_mode: 'profile',
}

export const DEFAULT_COPY_LIMIT_STATE: CopyLimitState = {
  paused_period_keys: [],
  periods: {},
}

export function normalizeCopyLimits(raw: unknown): CopyLimitsConfig {
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const profitTargets = Array.isArray(j.profit_targets)
    ? j.profit_targets
      .map((row, idx) => {
        const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
        const value = Number(r.value)
        const period = String(r.period ?? 'daily')
        const valueType = String(r.value_type ?? 'amount')
        const validPeriod = ['daily', 'weekly', 'monthly', 'overall'].includes(period)
          ? (period as CopyLimitPeriod)
          : 'daily'
        const validType = valueType === 'percent' ? 'percent' : 'amount'
        return {
          id: String(r.id ?? `pt-${idx}`),
          enabled: r.enabled !== false,
          period: validPeriod,
          value_type: validType,
          value: Number.isFinite(value) && value > 0 ? value : 0,
        } satisfies ProfitTargetRule
      })
      .filter(r => r.value > 0)
    : []

  let maxRisk: MaxRiskRule | undefined
  if (j.max_risk && typeof j.max_risk === 'object') {
    const mr = j.max_risk as Record<string, unknown>
    const value = Number(mr.value)
    const period = String(mr.period ?? 'daily')
    const valueType = String(mr.value_type ?? 'amount')
    if (Number.isFinite(value) && value > 0) {
      maxRisk = {
        period: ['daily', 'weekly', 'monthly', 'overall'].includes(period)
          ? (period as CopyLimitPeriod)
          : 'daily',
        value_type: valueType === 'percent' ? 'percent' : 'amount',
        value,
      }
    }
  }

  const tzMode = String(j.timezone_mode ?? 'profile')
  return {
    profit_targets_enabled: j.profit_targets_enabled === true,
    profit_targets: profitTargets,
    max_risk_enabled: j.max_risk_enabled === true && maxRisk != null,
    max_risk: maxRisk,
    timezone_mode: tzMode === 'custom' ? 'custom' : 'profile',
    timezone: typeof j.timezone === 'string' && j.timezone.trim() ? j.timezone.trim() : undefined,
  }
}

export function normalizeCopyLimitState(raw: unknown): CopyLimitState {
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const paused = Array.isArray(j.paused_period_keys)
    ? j.paused_period_keys.map(k => String(k)).filter(Boolean)
    : []
  const periods: Record<string, CopyLimitPeriodSnapshot> = {}
  if (j.periods && typeof j.periods === 'object') {
    for (const [key, val] of Object.entries(j.periods as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue
      const row = val as Record<string, unknown>
      const ref = Number(row.reference_equity)
      const peak = Number(row.peak_channel_pnl)
      periods[key] = {
        period_key: String(row.period_key ?? key),
        reference_equity: Number.isFinite(ref) ? ref : 0,
        peak_channel_pnl: Number.isFinite(peak) ? peak : 0,
        last_evaluated_at: String(row.last_evaluated_at ?? ''),
      }
    }
  }
  return { paused_period_keys: paused, periods }
}

export function pauseKey(kind: 'profit' | 'risk', period: CopyLimitPeriod, periodKey: string, ruleId?: string): string {
  if (period === 'overall') {
    return ruleId ? `${kind}:overall:${ruleId}` : `${kind}:overall`
  }
  return `${kind}:${period}:${periodKey}${ruleId ? `:${ruleId}` : ''}`
}
