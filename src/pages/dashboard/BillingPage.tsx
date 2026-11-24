import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CreditCard,
  ExternalLink,
  Minus,
  Plus,
  Users,
  Zap,
} from 'lucide-react'
import { useT, useLocale } from '../../context/LocaleContext'
import { useAuth } from '../../context/AuthContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { getSubscribeCtaLabel } from '../../lib/subscriptionCta'
import { interpolate } from '../../i18n/interpolate'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageShell } from '../../components/layout/PageShell'
import { PageHeader } from '../../components/layout/PageHeader'
import { BillingTabs, type BillingTabId } from '../../components/billing/BillingTabs'
import { PaymentMethodsPanel } from '../../components/billing/PaymentMethodsPanel'
import { ReceiptsPanel } from '../../components/billing/ReceiptsPanel'
import {
  customerRefFromUserId,
  fetchBillingHistory,
  formatBillingMoney,
  type BillingHistoryResponse,
} from '../../lib/billingApi'
import { PRICING_ADVANCED_INCLUDED_ACCOUNTS } from '../../lib/pricingPlans'
import {
  fetchMySocialCopyBilling,
  isActiveSocialCopyBilling,
  startSocialCopyBillingPortal,
  type MySocialCopyBilling,
} from '../../lib/socialCopy'
import { supabase } from '../../lib/supabase'

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function SummaryCard({
  label,
  value,
  hint,
  status,
}: {
  label: string
  value: string
  hint?: string
  status?: string
}) {
  return (
    <Card padding="md" className="flex flex-col justify-between min-h-[120px]">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-900 dark:text-neutral-50">
        {label}
      </p>
      <div className="mt-3">
        <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{value}</p>
        {status ? (
          <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{status}</p>
        ) : hint ? (
          <p className="mt-1 text-xs text-neutral-900 dark:text-neutral-50">{hint}</p>
        ) : null}
      </div>
    </Card>
  )
}

export function BillingPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const t = useT()
  const { locale } = useLocale()
  const bt = t.pricing.billing
  const { user, session } = useAuth()
  const { isAdmin, adminUntil } = useUserProfile()
  const {
    subscription,
    hasActiveSubscription,
    effectivePlan,
    loading: subscriptionLoading,
    refresh,
    isPastDue,
    hasTrialExpired,
  } = useSubscription()

  const subscribeCta = getSubscribeCtaLabel(t, { isPastDue, effectivePlan, hasTrialExpired })

  const tabParam = searchParams.get('tab')
  const activeTab: BillingTabId =
    tabParam === 'payment_methods' || tabParam === 'receipts' ? tabParam : 'subscription'

  const setActiveTab = (id: BillingTabId) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'subscription') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  const [portalLoading, setPortalLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [extraCount, setExtraCount] = useState<number | null>(null)
  const [savingExtras, setSavingExtras] = useState(false)
  const [extraSaved, setExtraSaved] = useState(false)
  const [copyBilling, setCopyBilling] = useState<MySocialCopyBilling[]>([])
  const [copyBillingLoading, setCopyBillingLoading] = useState(false)
  const [copyBillingError, setCopyBillingError] = useState('')
  const [copyPortalBusyId, setCopyPortalBusyId] = useState<string | null>(null)

  const refreshCopyBilling = useCallback(async () => {
    if (!user) {
      setCopyBilling([])
      return
    }
    setCopyBillingLoading(true)
    setCopyBillingError('')
    try {
      setCopyBilling(await fetchMySocialCopyBilling(supabase))
    } catch (cause) {
      setCopyBilling([])
      setCopyBillingError(cause instanceof Error ? cause.message : bt.copySubscriptionsLoadFailed)
    } finally {
      setCopyBillingLoading(false)
    }
  }, [bt.copySubscriptionsLoadFailed, user])

  useEffect(() => {
    void refreshCopyBilling()
  }, [refreshCopyBilling])

  const openCopyPortal = async (providerUserId: string) => {
    if (!session?.access_token) {
      setCopyBillingError(bt.copySubscriptionsSignIn)
      return
    }
    setCopyPortalBusyId(providerUserId)
    setCopyBillingError('')
    try {
      const url = await startSocialCopyBillingPortal({
        accessToken: session.access_token,
        providerUserId,
        returnUrl: `${window.location.origin}/billing`,
      })
      window.location.assign(url)
    } catch (cause) {
      setCopyBillingError(cause instanceof Error ? cause.message : bt.copySubscriptionsPortalFailed)
      setCopyPortalBusyId(null)
    }
  }

  const copyStatusLabel = (row: MySocialCopyBilling) => {
    if (isActiveSocialCopyBilling(row)) return bt.copyStatusActive
    if (row.status === 'past_due') return bt.copyStatusPastDue
    if (row.status === 'canceled') return bt.copyStatusCanceled
    return bt.copyStatusIncomplete
  }

  const [billingMeta, setBillingMeta] = useState<Omit<BillingHistoryResponse, 'invoices'> | null>(null)

  const localeTag = locale === 'es' ? 'es-ES' : locale === 'fr' ? 'fr-FR' : 'en-US'
  const customerRef = user ? customerRefFromUserId(user.id) : '—'
  const currentExtra = subscription?.extra_accounts ?? 0
  const editingExtra = extraCount ?? currentExtra

  const statusLabel = subscription
    ? {
        active: bt.statusActive,
        trialing: bt.statusTrialing,
        canceled: bt.statusCanceled,
        past_due: bt.statusPastDue,
        incomplete: bt.statusPastDue,
        incomplete_expired: bt.statusPastDue,
      }[subscription.status] || subscription.status
    : ''

  const memberSinceIso = subscription?.created_at ?? user?.created_at ?? null

  const planDisplay = useMemo(() => {
    if (isAdmin) {
      const summary = adminUntil
        ? interpolate(bt.adminPlanSummaryUntil, {
            date: formatShortDate(adminUntil, localeTag),
          })
        : bt.adminPlanSummary
      return { name: 'Admin', summary }
    }
    if (!hasActiveSubscription || !effectivePlan) {
      return { name: bt.freePlan, summary: bt.freePlanSummary }
    }
    if (effectivePlan === 'advanced') {
      return { name: t.pricing.advanced.name, summary: bt.advancedPlanSummary }
    }
    return { name: t.pricing.basic.name, summary: bt.basicPlanSummary }
  }, [isAdmin, adminUntil, hasActiveSubscription, effectivePlan, bt, t.pricing.advanced.name, t.pricing.basic.name, localeTag])

  const nextRenewalDisplay = useMemo(() => {
    if (!hasActiveSubscription || !subscription) return { value: '—', hint: bt.noActiveSubscription }
    if (subscription.status === 'trialing' && subscription.trial_ends_at) {
      return {
        value: formatShortDate(subscription.trial_ends_at, localeTag),
        hint: bt.trialEnds,
      }
    }
    if (subscription.current_period_end) {
      return {
        value: formatShortDate(subscription.current_period_end, localeTag),
        hint: undefined,
      }
    }
    return { value: '—', hint: bt.noActiveSubscription }
  }, [hasActiveSubscription, subscription, bt, localeTag])

  const billedDisplay = useMemo(() => {
    if (billingMeta?.currentPeriodAmount != null && billingMeta.currentPeriodAmount > 0) {
      return formatBillingMoney(billingMeta.currentPeriodAmount, 'usd', localeTag)
    }
    if (!hasActiveSubscription) {
      return { value: '—', hint: bt.noActiveSubscription } as const
    }
    return '—'
  }, [billingMeta, hasActiveSubscription, bt.noActiveSubscription, localeTag])

  useEffect(() => {
    if (!session?.access_token) return
    let cancelled = false
    void fetchBillingHistory(session.access_token, { limit: 1 })
      .then((data) => {
        if (cancelled) return
        setBillingMeta({
          hasMore: data.hasMore,
          customerId: data.customerId,
          balance: data.balance,
          billingInterval: data.billingInterval,
          currentPeriodAmount: data.currentPeriodAmount,
        })
      })
      .catch(() => {
        /* summary only — receipts tab loads its own list */
      })
    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  const openCustomerPortal = async (flow?: 'cancel') => {
    if (!session) return
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-portal`
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        returnUrl: `${window.location.origin}/billing`,
        ...(flow ? { flow } : {}),
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
    if (!res.ok || !data.url) {
      throw new Error(data.error || bt.cancelSubscriptionFailed)
    }
    window.location.href = data.url
  }

  const handleManageBilling = async () => {
    if (!session) return
    setPortalLoading(true)
    setCancelError('')
    try {
      await openCustomerPortal()
    } catch {
      setCancelError(bt.cancelSubscriptionFailed)
    } finally {
      setPortalLoading(false)
    }
  }

  const handleCancelSubscription = async () => {
    if (!session) return
    setCancelLoading(true)
    setCancelError('')
    try {
      await openCustomerPortal('cancel')
    } catch {
      setCancelError(bt.cancelSubscriptionFailed)
    } finally {
      setCancelLoading(false)
    }
  }

  const canCancelSubscription =
    hasActiveSubscription
    && Boolean(subscription?.stripe_subscription_id?.startsWith('sub_'))
    && (subscription?.status === 'active' || subscription?.status === 'trialing')

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

  const billedValue = typeof billedDisplay === 'string' ? billedDisplay : billedDisplay.value
  const billedHint = typeof billedDisplay === 'string' ? undefined : billedDisplay.hint

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
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm">
              <div>
                <span className="text-neutral-900 dark:text-neutral-50">{bt.customerId}: </span>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{customerRef}</span>
              </div>
            </div>
            <Button className="gap-2" onClick={() => navigate('/pricing')}>
              <Zap className="h-4 w-4" />
              {subscribeCta}
            </Button>
          </div>
        }
        actionsBreakpoint="lg"
      />

      <div className="mt-6">
        <BillingTabs
          active={activeTab}
          onChange={setActiveTab}
          labels={{
            subscription: bt.tabSubscription,
            payment_methods: bt.tabPaymentMethods,
            receipts: bt.tabReceipts,
          }}
        />
      </div>

      {activeTab === 'payment_methods' && session?.access_token ? (
        <div className="mt-8">
          <PaymentMethodsPanel
            accessToken={session.access_token}
            copy={{
              title: bt.paymentMethodsTitle,
              subtitle: bt.paymentMethodsSubtitle,
              emptyTitle: bt.paymentMethodsEmptyTitle,
              emptyHint: bt.paymentMethodsEmptyHint,
              addCard: bt.paymentMethodsAddCard,
              addCardHint: bt.paymentMethodsAddCardHint,
              saveCard: bt.paymentMethodsSaveCard,
              removeCard: bt.paymentMethodsRemove,
              footerNote: bt.paymentMethodsFooter,
            }}
          />
        </div>
      ) : null}

      {activeTab === 'receipts' && session?.access_token ? (
        <div className="mt-8">
          <ReceiptsPanel accessToken={session.access_token} />
        </div>
      ) : null}

      {activeTab === 'subscription' ? (
      <div className="mt-8 space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label={bt.memberSince}
            value={memberSinceIso ? formatShortDate(memberSinceIso, localeTag) : '—'}
            status={
              hasActiveSubscription && statusLabel
                ? interpolate(bt.statusLine, { status: statusLabel })
                : undefined
            }
          />
          <SummaryCard
            label={bt.nextRenewal}
            value={nextRenewalDisplay.value}
            hint={nextRenewalDisplay.hint}
          />
          <SummaryCard
            label={bt.currentPlan}
            value={planDisplay.name}
            hint={planDisplay.summary}
          />
          <SummaryCard
            label={bt.billed}
            value={billedValue}
            hint={billedHint}
          />
        </div>

        {hasActiveSubscription && subscription ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleManageBilling()}
                loading={portalLoading}
                disabled={cancelLoading}
                className="gap-2"
              >
                {bt.manageBilling}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              {canCancelSubscription ? (
                <Button
                  variant="danger"
                  onClick={() => void handleCancelSubscription()}
                  loading={cancelLoading}
                  disabled={portalLoading}
                  className="gap-2"
                  title={bt.cancelSubscriptionHint}
                >
                  {bt.cancelSubscription}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
            {canCancelSubscription ? (
              <p className="text-xs text-neutral-900 dark:text-neutral-50">
                {bt.cancelSubscriptionHint}
              </p>
            ) : null}
            {cancelError ? (
              <p className="text-xs text-error-600 dark:text-error-400">{cancelError}</p>
            ) : null}
          </div>
        ) : null}

        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-neutral-200/65 px-6 py-4 dark:border-neutral-800/55">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/40">
                <Users className="h-4 w-4 text-green-400 dark:text-green-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                  {bt.copySubscriptionsTitle}
                </h2>
                <p className="mt-0.5 text-xs text-neutral-900 dark:text-neutral-50">
                  {bt.copySubscriptionsHint}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={copyBillingLoading}
                onClick={() => void refreshCopyBilling()}
              >
                {bt.copySubscriptionsRefresh}
              </Button>
            </div>
          </div>
          {copyBillingError ? (
            <div className="px-6 py-4 text-sm text-amber-700 dark:text-amber-300">{copyBillingError}</div>
          ) : null}
          {copyBillingLoading && copyBilling.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-900 dark:text-neutral-50">
              {t.common.loading}
            </div>
          ) : copyBilling.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-neutral-900 dark:text-neutral-50">
              {bt.copySubscriptionsEmpty}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200/65 dark:divide-neutral-800/55">
              {copyBilling.map(row => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {row.providerDisplayName}
                      {row.providerUsername ? (
                        <span className="ms-2 text-xs font-normal text-neutral-500">
                          @{row.providerUsername}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                      {copyStatusLabel(row)}
                      {row.cancelAtPeriodEnd ? ` · ${bt.copyCancelsAtPeriodEnd}` : ''}
                      {row.currentPeriodEnd
                        ? ` · ${interpolate(bt.copyPeriodEnds, {
                            date: formatShortDate(row.currentPeriodEnd, localeTag),
                          })}`
                        : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      {bt.copyEntitlementNote}
                    </p>
                  </div>
                  {row.stripeSubscriptionId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-2"
                      loading={copyPortalBusyId === row.providerUserId}
                      onClick={() => void openCopyPortal(row.providerUserId)}
                    >
                      {bt.copyManage}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

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
                  onChange={e => setExtraCount(Math.max(0, Math.min(95, Number(e.target.value) || 0)))}
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
                <p className="text-xs font-medium text-green-600 dark:text-green-400">{t.settings.saved}</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {!hasActiveSubscription && !subscriptionLoading ? (
          <Card padding="lg">
            <div className="flex flex-col items-center py-6 text-center">
              <CreditCard className="h-10 w-10 text-neutral-900 dark:text-neutral-50" />
              <p className="mt-4 text-sm text-neutral-900 dark:text-neutral-50">{bt.noPlan}</p>
              <Button className="mt-4" onClick={() => navigate('/pricing')}>
                {bt.choosePlan}
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="lg">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  {bt.subscriptionPlans}
                </h2>
                <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-50">
                  {bt.subscriptionPlansIntro}
                </p>
              </div>
              <Button variant="secondary" onClick={() => navigate('/pricing')}>
                {bt.choosePlan}
              </Button>
            </div>
          </Card>
        )}
      </div>
      ) : null}
    </PageShell>
  )
}
