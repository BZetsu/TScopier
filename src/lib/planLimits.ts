import {
  BACKTEST_QUOTA_RUN_MODE,
  PLAN_LIMITS,
  canUseFeature,
  effectivePlan,
  isSubscriptionActive,
  isTrialEnded,
  maxBacktestsPerMonth,
  maxBrokerAccounts,
  maxTelegramChannels,
  maxTradingViewWebhooks,
  maxTpRows,
  type PlanFeatureKey,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '../../supabase/functions/_shared/planLimits.ts'

export {
  BACKTEST_QUOTA_RUN_MODE,
  PLAN_LIMITS,
  canUseFeature,
  effectivePlan,
  isSubscriptionActive,
  isTrialEnded,
  maxBacktestsPerMonth,
  maxBrokerAccounts,
  maxTelegramChannels,
  maxTradingViewWebhooks,
  maxTpRows,
}
export type { PlanFeatureKey, SubscriptionPlan, SubscriptionStatus }

/** Plan + status for persisting channel manual settings (admin → advanced/active). */
export function planContextForManualSettings(
  effectivePlan: SubscriptionPlan | null,
  subscription: {
    plan?: SubscriptionPlan
    status?: string | null
    trial_ends_at?: string | null
  } | null,
): { plan: SubscriptionPlan | null | undefined; status: string | null | undefined } {
  if (effectivePlan) {
    const st = subscription?.status
    return {
      plan: effectivePlan,
      status: st && isSubscriptionActive(st, subscription?.trial_ends_at) ? st : 'active',
    }
  }
  return { plan: subscription?.plan, status: subscription?.status ?? null }
}

export function normalizeManualSettingsForPlan<T extends Record<string, unknown>>(
  plan: SubscriptionPlan | null | undefined,
  status: string | null | undefined,
  settings: T,
  trialEndsAt?: string | Date | null,
): T {
  const effective = effectivePlan(plan, status, trialEndsAt)
  if (effective === 'advanced') return settings

  // Keep the frontend's settings behavior local. This differs from the Edge
  // normalizer by preserving the legacy range-layering defaults.
  const next = { ...settings } as Record<string, unknown>
  next.trade_style = 'single'
  next.range_trading = false
  next.layering_mode = 'legacy'
  next.range_layering_type = 'auto'
  next.reverse_signal = false
  next.close_worse_entries = false
  next.move_sl_to_entry_after_mode = 'none'
  next.rr_for_sl_enabled = false
  next.rr_for_tps_enabled = false

  if (Array.isArray(next.tp_lots) && next.tp_lots.length > PLAN_LIMITS.basic.maxTpRows) {
    next.tp_lots = next.tp_lots.slice(0, PLAN_LIMITS.basic.maxTpRows)
  }

  return next as T
}

/**
 * Advanced-only settings that a Basic account cannot run. The worker refuses to
 * execute signals for these, so the configure screen has to name them.
 */
export type AdvancedOnlySetting =
  | 'multi_trade'
  | 'range_trading'
  | 'move_sl_to_entry'
  | 'reverse_signal'
  | 'close_worse_entries'
  | 'risk_reward'

export function advancedOnlySettingsInUse(
  settings: Record<string, unknown> | null | undefined,
): AdvancedOnlySetting[] {
  if (!settings || typeof settings !== 'object') return []
  const found: AdvancedOnlySetting[] = []
  if (settings.trade_style === 'multi') found.push('multi_trade')
  if (settings.range_trading === true) found.push('range_trading')
  if (settings.reverse_signal === true) found.push('reverse_signal')
  if (settings.close_worse_entries === true) found.push('close_worse_entries')
  const beMode = String(settings.move_sl_to_entry_after_mode ?? 'none')
  if (beMode !== 'none' && beMode !== '') found.push('move_sl_to_entry')
  if (settings.rr_for_sl_enabled === true || settings.rr_for_tps_enabled === true) {
    found.push('risk_reward')
  }
  return found
}

export function manualSettingsUseAdvancedFeatures(settings: Record<string, unknown>): boolean {
  return advancedOnlySettingsInUse(settings).length > 0
}

export interface PlanLimitsSnapshot {
  maxBrokerAccounts: number
  maxTelegramChannels: number | null
  maxTradingViewWebhooks: number | null
  maxBacktestsPerMonth: number | null
  maxTpRows: number | null
}

export function planLimitsSnapshot(
  plan: SubscriptionPlan | null | undefined,
  status: string | null | undefined,
  extraAccounts = 0,
  trialEndsAt?: string | Date | null,
): PlanLimitsSnapshot {
  const effective = effectivePlan(plan, status, trialEndsAt)
  return {
    maxBrokerAccounts: maxBrokerAccounts(effective ?? undefined, extraAccounts),
    maxTelegramChannels: maxTelegramChannels(effective ?? undefined),
    maxTradingViewWebhooks: maxTradingViewWebhooks(effective ?? undefined),
    maxBacktestsPerMonth: maxBacktestsPerMonth(effective ?? undefined),
    maxTpRows: maxTpRows(effective ?? undefined),
  }
}
