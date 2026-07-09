export type SubscriptionPlan = 'basic' | 'advanced'

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'canceled'
  | 'past_due'
  | 'incomplete'

/** True when trial_ends_at is a parseable timestamp strictly before `now`. */
export function isTrialEnded(
  trialEndsAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (trialEndsAt == null || trialEndsAt === '') return false
  const end =
    typeof trialEndsAt === 'string' ? Date.parse(trialEndsAt) : trialEndsAt.getTime()
  if (!Number.isFinite(end)) return false
  return end < now.getTime()
}

/**
 * Paid `active` always counts. `trialing` counts only while trial_ends_at is
 * unset/unparseable or still in the future.
 */
export function isSubscriptionActive(
  status: string | null | undefined,
  trialEndsAt?: string | Date | null,
): boolean {
  if (status === 'active') return true
  if (status === 'trialing') return !isTrialEnded(trialEndsAt)
  return false
}

export function effectivePlan(
  plan: SubscriptionPlan | null | undefined,
  status: string | null | undefined,
  trialEndsAt?: string | Date | null,
): SubscriptionPlan | null {
  if (!isSubscriptionActive(status, trialEndsAt)) return null
  return plan ?? null
}

export function manualSettingsUseAdvancedFeatures(settings: Record<string, unknown>): boolean {
  if (settings.trade_style === 'multi') return true
  if (settings.range_trading === true) return true
  if (settings.reverse_signal === true) return true
  if (settings.close_worse_entries === true) return true
  const beMode = String(settings.move_sl_to_entry_after_mode ?? 'none')
  if (beMode !== 'none' && beMode !== '') return true
  if (settings.rr_for_sl_enabled === true || settings.rr_for_tps_enabled === true) return true
  return false
}
