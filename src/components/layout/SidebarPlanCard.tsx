import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../context/LocaleContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { interpolate } from '../../i18n/interpolate'
import { maxBrokerAccounts } from '../../lib/planLimits'
import { getSubscribeCtaLabel } from '../../lib/subscriptionCta'

export function SidebarPlanCard({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const {
    usage,
    isAdmin,
    effectivePlan,
    hasActiveSubscription,
    isPastDue,
    hasTrialExpired,
    openUpgrade,
    subscription,
  } = useSubscription()

  const limit = isAdmin
    ? maxBrokerAccounts('advanced', 95)
    : hasActiveSubscription && effectivePlan
      ? maxBrokerAccounts(effectivePlan, subscription?.extra_accounts ?? 0)
      : maxBrokerAccounts('basic', 0)

  const used = usage.brokerAccounts
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0

  const badgeLabel = isAdmin
    ? 'Admin'
    : !hasActiveSubscription
      ? t.nav.planFree
      : effectivePlan === 'advanced'
        ? t.pricing.advanced.name
        : t.pricing.basic.name

  const ctaLabel = getSubscribeCtaLabel(t, { isPastDue, effectivePlan, hasTrialExpired })

  const onCta = () => {
    onNavigate?.()
    if (hasActiveSubscription && effectivePlan === 'advanced' && !isAdmin) {
      navigate('/billing')
      return
    }
    openUpgrade('advanced')
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onCta}
        title={`${t.nav.planCardLabel}: ${badgeLabel}`}
        className={clsx(
          'mx-auto flex h-10 w-10 items-center justify-center rounded-full',
          'bg-neutral-950 text-[10px] font-bold uppercase tracking-wide text-white',
          'shadow-xs transition-colors hover:bg-neutral-800',
          'dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white',
        )}
      >
        {badgeLabel.slice(0, 1)}
      </button>
    )
  }

  return (
    <div
      className={clsx(
        'rounded-2xl border border-teal-200/80 bg-white p-3 shadow-xs',
        'dark:border-teal-900/50 dark:bg-neutral-950/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t.nav.planCardLabel}
        </p>
        <span
          className={clsx(
            'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            hasActiveSubscription || isAdmin
              ? 'border-teal-300 text-teal-800 dark:border-teal-700 dark:text-teal-300'
              : 'border-neutral-300 text-neutral-700 dark:border-neutral-600 dark:text-neutral-300',
          )}
        >
          {badgeLabel}
        </span>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-teal-50 dark:bg-teal-950/60"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={interpolate(t.nav.planAccountsUsed, {
          used: String(used),
          limit: String(limit),
        })}
      >
        <div
          className="h-full rounded-full bg-teal-400 transition-[width] duration-300 dark:bg-teal-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
        {interpolate(t.nav.planAccountsUsed, {
          used: String(used),
          limit: String(limit),
        })}
      </p>

      <button
        type="button"
        onClick={onCta}
        className={clsx(
          'mt-3 flex w-full items-center justify-center rounded-full px-3 py-2',
          'bg-neutral-950 text-xs font-semibold text-white shadow-xs',
          'transition-colors hover:bg-neutral-800',
          'dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white',
        )}
      >
        {ctaLabel}
      </button>
    </div>
  )
}
