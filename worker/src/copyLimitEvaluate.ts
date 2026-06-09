import { periodKeyFor, periodStorageKey, pruneExpiredPauseKeys } from './copyLimitPeriods'
import type {
  CopyLimitPeriod,
  CopyLimitState,
  CopyLimitsConfig,
  MaxRiskRule,
  ProfitTargetRule,
} from './copyLimitTypes'
import { pauseKey } from './copyLimitTypes'

/** Account equity relative to period-start baseline. */
export type EquitySnapshot = {
  currentEquity: number
  periodStartEquity: number
  peakEquity: number
}

export type CopyLimitBreach = {
  kind: 'profit' | 'risk'
  reason: 'channel_profit_target_hit' | 'channel_max_risk_hit'
  pauseKey: string
  ruleId?: string
}

export function resolveCopyLimitTimezone(
  config: CopyLimitsConfig,
  profileTimezone: string | null | undefined,
): string {
  if (config.timezone_mode === 'custom' && config.timezone?.trim()) {
    return config.timezone.trim()
  }
  return profileTimezone?.trim() || 'UTC'
}

export function copyLimitsActive(config: CopyLimitsConfig | null | undefined): boolean {
  if (!config) return false
  const profitOn = config.profit_targets_enabled
    && config.profit_targets.some(t => t.enabled && t.value > 0)
  const riskOn = config.max_risk_enabled
    && config.max_risks.some(t => t.enabled && t.value > 0)
  return profitOn || riskOn
}

export function equityDelta(equity: EquitySnapshot): number {
  return equity.currentEquity - equity.periodStartEquity
}

function profitTargetHit(
  rule: ProfitTargetRule,
  equity: EquitySnapshot,
): boolean {
  if (!rule.enabled || rule.value <= 0) return false
  const delta = equityDelta(equity)
  if (rule.value_type === 'amount') {
    return delta >= rule.value
  }
  if (equity.periodStartEquity <= 0) return false
  return (delta / equity.periodStartEquity) * 100 >= rule.value
}

function maxRiskHit(
  rule: MaxRiskRule,
  equity: EquitySnapshot,
): boolean {
  if (!rule.enabled || rule.value <= 0) return false
  const delta = equityDelta(equity)
  if (rule.value_type === 'amount') {
    return delta <= -rule.value
  }
  if (equity.periodStartEquity <= 0) return false
  const drawdown = Math.max(0, equity.peakEquity - equity.currentEquity)
  return (drawdown / equity.periodStartEquity) * 100 >= rule.value
}

export function evaluateCopyLimitBreaches(args: {
  config: CopyLimitsConfig
  state: CopyLimitState
  equity: EquitySnapshot
  timeZone: string
  at?: Date
}): CopyLimitBreach[] {
  const at = args.at ?? new Date()
  const breaches: CopyLimitBreach[] = []

  if (args.config.profit_targets_enabled) {
    for (const rule of args.config.profit_targets) {
      if (!profitTargetHit(rule, args.equity)) continue
      const pk = periodKeyFor(rule.period, args.timeZone, at)
      breaches.push({
        kind: 'profit',
        reason: 'channel_profit_target_hit',
        pauseKey: pauseKey('profit', rule.period, pk, rule.id),
        ruleId: rule.id,
      })
    }
  }

  if (args.config.max_risk_enabled) {
    for (const rule of args.config.max_risks) {
      if (!maxRiskHit(rule, args.equity)) continue
      const pk = periodKeyFor(rule.period, args.timeZone, at)
      breaches.push({
        kind: 'risk',
        reason: 'channel_max_risk_hit',
        pauseKey: pauseKey('risk', rule.period, pk, rule.id),
        ruleId: rule.id,
      })
    }
  }

  return breaches
}

export function updatePeriodSnapshots(args: {
  state: CopyLimitState
  config: CopyLimitsConfig
  currentEquity: number
  timeZone: string
  at?: Date
}): CopyLimitState {
  const at = args.at ?? new Date()
  const periods = { ...args.state.periods }
  const periodKinds: CopyLimitPeriod[] = ['daily', 'weekly', 'monthly', 'overall']

  const touchPeriod = (period: CopyLimitPeriod) => {
    const pk = periodKeyFor(period, args.timeZone, at)
    const storageKey = periodStorageKey(period, pk)
    const prev = periods[storageKey]
    const periodStart = prev?.reference_equity && prev.reference_equity > 0
      ? prev.reference_equity
      : args.currentEquity
    const peak = Math.max(prev?.peak_equity ?? args.currentEquity, args.currentEquity)
    periods[storageKey] = {
      period_key: pk,
      reference_equity: periodStart,
      peak_equity: peak,
      last_evaluated_at: at.toISOString(),
    }
  }

  if (args.config.profit_targets_enabled) {
    for (const rule of args.config.profit_targets) {
      if (rule.enabled) touchPeriod(rule.period)
    }
  }
  if (args.config.max_risk_enabled) {
    for (const rule of args.config.max_risks) {
      if (rule.enabled) touchPeriod(rule.period)
    }
  }

  for (const period of periodKinds) {
    const pk = periodKeyFor(period, args.timeZone, at)
    const storageKey = periodStorageKey(period, pk)
    if (!periods[storageKey]) continue
    const currentPk = periods[storageKey]?.period_key
    if (currentPk && currentPk !== pk) {
      delete periods[storageKey]
    }
  }

  const paused_period_keys = pruneExpiredPauseKeys(args.state.paused_period_keys, args.timeZone, at)
  const flattened_pause_keys = pruneExpiredPauseKeys(args.state.flattened_pause_keys ?? [], args.timeZone, at)

  return { paused_period_keys, flattened_pause_keys, periods }
}

export function mergeBreachesIntoState(
  state: CopyLimitState,
  breaches: CopyLimitBreach[],
): CopyLimitState {
  const set = new Set(state.paused_period_keys)
  for (const b of breaches) set.add(b.pauseKey)
  return { ...state, paused_period_keys: [...set] }
}

export function isChannelCopyLimitPaused(args: {
  config: CopyLimitsConfig | null | undefined
  state: CopyLimitState | null | undefined
  timeZone: string
  at?: Date
}): CopyLimitBreach | null {
  if (!copyLimitsActive(args.config)) return null
  const state = args.state ?? { paused_period_keys: [], periods: {} }
  const at = args.at ?? new Date()
  const active = pruneExpiredPauseKeys(state.paused_period_keys, args.timeZone, at)
  if (!active.length) return null

  const key = active[0]!
  if (key.startsWith('risk:')) {
    return { kind: 'risk', reason: 'channel_max_risk_hit', pauseKey: key }
  }
  return { kind: 'profit', reason: 'channel_profit_target_hit', pauseKey: key }
}

export function periodEquitySnapshot(
  state: CopyLimitState,
  period: CopyLimitPeriod,
  currentEquity: number,
  timeZone: string,
  at = new Date(),
): EquitySnapshot {
  const pk = periodKeyFor(period, timeZone, at)
  const storageKey = periodStorageKey(period, pk)
  const snap = state.periods[storageKey]
  const periodStartEquity = snap?.reference_equity && snap.reference_equity > 0
    ? snap.reference_equity
    : currentEquity
  const peakEquity = Math.max(snap?.peak_equity ?? currentEquity, currentEquity)
  return { currentEquity, periodStartEquity, peakEquity }
}
