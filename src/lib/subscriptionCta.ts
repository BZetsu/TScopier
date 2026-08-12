import type { SubscriptionPlan } from './planLimits'
import type { Translations } from '../i18n/locales/types'
import { isTrialEnded } from './planLimits'

type SubscribeCtaOptions = {
  isPastDue: boolean
  effectivePlan: SubscriptionPlan | null
  hasTrialExpired: boolean
}

/** Primary subscribe / upgrade button label for users without an active Advanced plan. */
export function getSubscribeCtaLabel(t: Translations, opts: SubscribeCtaOptions): string {
  const pw = t.pricing.paywall
  if (opts.isPastDue) return pw.updatePayment
  if (opts.effectivePlan === 'basic') return pw.upgradeCta
  if (opts.hasTrialExpired) return pw.purchaseSubscriptionCta
  return t.pricing.startTrial
}

/** True when trial_ends_at is set and that timestamp is in the past. */
export function hasTrialExpired(trialEndsAt: string | null | undefined): boolean {
  return isTrialEnded(trialEndsAt)
}
