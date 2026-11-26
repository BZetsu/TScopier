import { useEffect, useState } from 'react'
import { Minus, Plus, Zap } from 'lucide-react'
import { useT } from '../../context/LocaleContext'
import { useAuth } from '../../context/AuthContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { getSubscribeCtaLabel } from '../../lib/subscriptionCta'
import { interpolate } from '../../i18n/interpolate'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageShell } from '../../components/layout/PageShell'
import { PageHeader } from '../../components/layout/PageHeader'
import { PricingPlansSection } from '../../components/marketing/sections/PricingPlansSection'
import { PRICING_ADVANCED_INCLUDED_ACCOUNTS } from '../../lib/pricingPlans'

/**
 * Subscription (/billing) = plans & capacity (choose/upgrade plan, extra accounts).
 * Membership status, payment methods, and receipts live on /membership.
 */
export function MembershipPage() {
  const t = useT()
  const bt = t.pricing.billing
  const { session } = useAuth()
  const { isAdmin } = useUserProfile()
  const {
    subscription,
    hasActiveSubscription,
    effectivePlan,
    refresh,
    isPastDue,
    hasTrialExpired,
  } = useSubscription()

  const subscribeCta = getSubscribeCtaLabel(t, { isPastDue, effectivePlan, hasTrialExpired })

  const [extraCount, setExtraCount] = useState<number | null>(null)
  const [savingExtras, setSavingExtras] = useState(false)
  const [extraSaved, setExtraSaved] = useState(false)

  const currentExtra = subscription?.extra_accounts ?? 0
  const editingExtra = extraCount ?? currentExtra

  useEffect(() => {
    setExtraCount(null)
  }, [subscription?.extra_accounts])

  const handleSaveExtras = async () => {
    if (!session || editingExtra === currentExtra) return
    setSavingExtras(true)
    setExtraSaved(false)
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-extra-accounts`
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ extraAccounts: editingExtra }),
      })
      await refresh()
      setExtraCount(null)
      setExtraSaved(true)
      setTimeout(() => setExtraSaved(false), 3000)
    } finally {
      setSavingExtras(false)
    }
  }

  const planName =
    effectivePlan === 'advanced'
      ? t.pricing.advanced.name
      : effectivePlan === 'basic'
        ? t.pricing.basic.name
        : bt.noPlan

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
              {bt.planPaymentsEyebrow}
            </span>
            <span className="block">{bt.title}</span>
            <span className="mt-1 block text-sm font-normal text-neutral-600 dark:text-neutral-300">
              {bt.subtitle}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {hasActiveSubscription && effectivePlan ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                {bt.currentPlan}:{' '}
                <span className="font-semibold text-neutral-900 dark:text-neutral-50">{planName}</span>
              </p>
            ) : null}
            <Button
              className="gap-2"
              onClick={() => {
                window.requestAnimationFrame(() => {
                  document.getElementById('billing-plans')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  })
                })
              }}
            >
              <Zap className="h-4 w-4" />
              {subscribeCta}
            </Button>
          </div>
        }
        actionsBreakpoint="lg"
      />

      <div className="mt-8 space-y-8">
        {hasActiveSubscription && subscription?.plan === 'advanced' && !isAdmin ? (
          <Card padding="lg">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  {bt.extraAccounts}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-900 dark:text-neutral-50">
                  {interpolate(bt.extraAccountsSummary, {
                    included: String(PRICING_ADVANCED_INCLUDED_ACCOUNTS),
                    extra: String(editingExtra),
                    total: String(PRICING_ADVANCED_INCLUDED_ACCOUNTS + editingExtra),
                  })}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExtraCount(Math.max(0, editingExtra - 1))}
                  disabled={editingExtra === 0 || savingExtras}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-900 transition-colors hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={editingExtra}
                  onChange={(e) =>
                    setExtraCount(Math.max(0, Math.min(95, Number(e.target.value) || 0)))
                  }
                  disabled={savingExtras}
                  className="h-9 w-16 rounded-lg border border-neutral-200 bg-white text-center text-sm font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                />
                <button
                  type="button"
                  onClick={() => setExtraCount(Math.min(95, editingExtra + 1))}
                  disabled={editingExtra >= 95 || savingExtras}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-900 transition-colors hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  <Plus className="h-4 w-4" />
                </button>

                {editingExtra !== currentExtra ? (
                  <Button size="sm" onClick={() => void handleSaveExtras()} loading={savingExtras}>
                    {t.common.save}
                  </Button>
                ) : null}
              </div>

              {extraSaved ? (
                <p className="text-xs font-medium text-green-600 dark:text-green-400">
                  {t.settings.saved}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        <div id="billing-plans" className="scroll-mt-4">
          <PricingPlansSection variant="app" />
        </div>
      </div>
    </PageShell>
  )
}
