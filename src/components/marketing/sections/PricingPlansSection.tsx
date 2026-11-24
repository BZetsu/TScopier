import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Zap } from 'lucide-react'
import { useT } from '../../../context/LocaleContext'
import { useAuth } from '../../../context/AuthContext'
import { useSubscription } from '../../../context/SubscriptionContext'
import { interpolate } from '../../../i18n/interpolate'
import { appAbsoluteUrl, appUrl } from '../../../lib/site'
import { HELP_LINKS } from '../../../lib/helpLinks'
import { checkoutCopyFromT, formatCheckoutPriceLabel } from '../../../lib/checkoutCopy'
import { getSubscribeCtaLabel } from '../../../lib/subscriptionCta'
import {
  clearPendingPlanSelection,
  loadPendingPlanSelection,
  signupUrlWithPlan,
  stashPendingPlanSelection,
  type PendingPlanSelection,
} from '../../../lib/pendingPlanSelection'
import { Button } from '../../ui/Button'
import {
  CheckoutPaymentStep,
  type CheckoutSelection,
} from '../../billing/CheckoutPaymentStep'
import { PaymentAcceptedLogos } from '../../billing/PaymentAcceptedLogos'
import {
  PRICING_ADVANCED_INCLUDED_ACCOUNTS,
  pricingDisplayPrices,
} from '../../../lib/pricingPlans'

interface PricingPlansSectionProps {
  variant?: 'marketing' | 'app'
}

export function PricingPlansSection({ variant = 'marketing' }: PricingPlansSectionProps) {
  const t = useT()
  const navigate = useNavigate()
  const lp = t.landing.pricing
  const pt = t.pricing
  const [searchParams, setSearchParams] = useSearchParams()
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')
  const [extraAccounts, setExtraAccounts] = useState(0)

  const { session } = useAuth()
  const {
    effectivePlan,
    isPastDue,
    hasTrialExpired,
    hasActiveSubscription,
    loading: subLoading,
    refresh,
  } = useSubscription()
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null)
  const autoCheckoutStarted = useRef(false)

  const advancedCheckoutCta = getSubscribeCtaLabel(t, {
    isPastDue,
    effectivePlan,
    hasTrialExpired,
  })

  const isApp = variant === 'app'
  const isAnnual = interval === 'annual'
  const prices = pricingDisplayPrices(interval, extraAccounts)

  const formatMoney = (amount: number) => `$${amount.toFixed(2)}`

  const contactHref = isApp
    ? HELP_LINKS.telegram || '/contact-support'
    : HELP_LINKS.telegram || appUrl('/contact-support')

  const referralFromUrl = (() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('ref')?.trim() || null
  })()

  const marketingSignupHref = (plan: 'basic' | 'advanced') => {
    const selection: PendingPlanSelection = {
      plan,
      interval,
      extraAccounts: plan === 'advanced' ? extraAccounts : 0,
    }
    return appUrl(signupUrlWithPlan(selection, referralFromUrl))
  }

  const openCheckout = (
    plan: 'basic' | 'advanced',
    opts?: { interval?: 'monthly' | 'annual'; extraAccounts?: number },
  ) => {
    if (!session?.access_token || effectivePlan === plan) return
    setCheckoutError('')
    clearPendingPlanSelection()
    setCheckoutSelection({
      plan,
      interval: opts?.interval ?? interval,
      extraAccounts: plan === 'advanced' ? (opts?.extraAccounts ?? extraAccounts) : 0,
    })
  }

  // Restore pending selection + open Card/Crypto checkout after signup/login.
  useEffect(() => {
    if (!isApp || subLoading || hasActiveSubscription || !session?.access_token) return
    if (autoCheckoutStarted.current) return

    const pending = loadPendingPlanSelection()
    const wantStart = searchParams.get('startCheckout') === '1'
    if (!pending && !wantStart) return

    if (pending) {
      setInterval(pending.interval)
      setExtraAccounts(pending.extraAccounts)
    }

    if (!pending) return

    autoCheckoutStarted.current = true
    if (wantStart) {
      const next = new URLSearchParams(searchParams)
      next.delete('startCheckout')
      setSearchParams(next, { replace: true })
    }
    openCheckout(pending.plan, {
      interval: pending.interval,
      extraAccounts: pending.extraAccounts,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when session/sub ready
  }, [isApp, subLoading, hasActiveSubscription, session?.access_token])

  const sectionClass = clsx(
    'mx-auto max-w-6xl scroll-mt-28',
    isApp ? 'px-0 py-4 sm:py-6' : 'px-5 py-16 sm:px-8 sm:py-24',
  )

  const planCta = (plan: 'basic' | 'advanced', label: string) => {
    const selection: PendingPlanSelection = {
      plan,
      interval,
      extraAccounts: plan === 'advanced' ? extraAccounts : 0,
    }
    if (session?.access_token) {
      return (
        <Button
          size="lg"
          className="w-full"
          disabled={effectivePlan === plan}
          onClick={() => {
            stashPendingPlanSelection(selection)
            openCheckout(plan)
          }}
        >
          {effectivePlan === plan ? pt.billing.currentPlan : label}
        </Button>
      )
    }
    return (
      <a
        href={marketingSignupHref(plan)}
        onClick={() => stashPendingPlanSelection(selection)}
        className="inline-flex w-full items-center justify-center rounded-xl bg-green-400 px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-green-500"
      >
        {label}
      </a>
    )
  }

  if (checkoutSelection && session?.access_token) {
    const checkoutPrices = pricingDisplayPrices(
      checkoutSelection.interval,
      checkoutSelection.extraAccounts,
    )
    const amount =
      checkoutSelection.plan === 'advanced'
        ? checkoutSelection.interval === 'annual'
          ? checkoutPrices.advancedAnnualTotal
          : checkoutPrices.advancedMonthly
        : checkoutSelection.interval === 'annual'
          ? checkoutPrices.basicAnnualTotal
          : checkoutPrices.basicMonthly
    return (
      <section className={sectionClass}>
        {checkoutError ? (
          <div
            role="alert"
            className="mx-auto mb-4 max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {checkoutError}
          </div>
        ) : null}
        <CheckoutPaymentStep
          selection={checkoutSelection}
          priceLabel={formatCheckoutPriceLabel(
            checkoutSelection.interval,
            amount,
            pt.perMonth,
            pt.perYear,
          )}
          accessToken={session.access_token}
          copy={checkoutCopyFromT(t)}
          successUrl={appAbsoluteUrl('/dashboard?checkout=success')}
          cancelUrl={`${window.location.origin}/billing`}
          onBack={() => {
            setCheckoutSelection(null)
            setCheckoutError('')
          }}
          onCardSuccess={() => {
            void refresh()
            navigate('/membership')
          }}
          onError={setCheckoutError}
        />
      </section>
    )
  }

  const intervalToggle = (
    <div className="inline-flex items-center rounded-full border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-900">
      <button
        type="button"
        onClick={() => setInterval('monthly')}
        className={clsx(
          'rounded-full px-5 py-2 text-sm font-medium transition-all',
          !isAnnual
            ? 'bg-green-400 text-neutral-950 shadow-xs'
            : 'text-neutral-900 hover:text-neutral-900 dark:text-neutral-50 dark:hover:text-neutral-100',
        )}
      >
        {pt.monthly}
      </button>
      <button
        type="button"
        onClick={() => setInterval('annual')}
        className={clsx(
          'rounded-full px-5 py-2 text-sm font-medium transition-all',
          isAnnual
            ? 'bg-green-400 text-neutral-950 shadow-xs'
            : 'text-neutral-900 hover:text-neutral-900 dark:text-neutral-50 dark:hover:text-neutral-100',
        )}
      >
        {pt.annual}
        <span className="ml-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
          {pt.save20}
        </span>
      </button>
    </div>
  )

  const featureList = (features: string[]) => (
    <div className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-black dark:text-neutral-50">
        {pt.features}
      </p>
      <ul className="mt-4 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden />
            <span className="text-sm text-black dark:text-neutral-50">{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  const contactCta =
    isApp && !HELP_LINKS.telegram ? (
      <Link
        to={contactHref}
        className="inline-flex w-full items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 sm:w-auto sm:min-w-[10rem]"
      >
        {pt.contactSales}
      </Link>
    ) : (
      <a
        href={contactHref}
        {...(HELP_LINKS.telegram ? { target: '_blank', rel: 'noopener noreferrer' } : undefined)}
        className="inline-flex w-full items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 sm:w-auto sm:min-w-[10rem]"
      >
        {pt.contactSales}
      </a>
    )

  const basicCard = (
    <div className="relative flex h-full flex-col rounded-2xl border border-neutral-200/65 bg-white p-8 shadow-xs dark:border-neutral-800/55 dark:bg-neutral-900">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{pt.basic.name}</h2>
        <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-50">{pt.basic.description}</p>
      </div>

      <div className="mb-1">
        <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
          {formatMoney(prices.basicMonthly)}
        </span>
        <span className="text-base text-neutral-900 dark:text-neutral-50">{pt.perMonth}</span>
      </div>
      {isAnnual ? (
        <p className="mb-6 text-xs text-neutral-900 dark:text-neutral-50">
          {pt.billedAnnually} {formatMoney(prices.basicAnnualTotal)}
          {pt.perYear}
        </p>
      ) : (
        <div className="mb-6" />
      )}

      {planCta('basic', pt.subscribe)}
      {featureList(pt.basicFeatures)}
    </div>
  )

  const advancedCard = (
    <div
      className={clsx(
        'relative flex h-full flex-col rounded-2xl border-2 border-green-400/80 p-8 shadow-md',
        'bg-[linear-gradient(155deg,#ecfdf5_0%,#f0fdf4_28%,#ffffff_62%,#f8fafc_100%)]',
        'dark:border-green-500/50 dark:bg-[linear-gradient(155deg,#042f2e_0%,#0a3d3a_32%,#0f172a_68%,#0a0a0a_100%)]',
        !isApp && 'lg:-mt-2 lg:mb-2',
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-green-300/40 blur-3xl dark:bg-teal-400/25" />
        <div className="absolute -bottom-24 -left-12 h-52 w-52 rounded-full bg-emerald-200/50 blur-3xl dark:bg-emerald-500/15" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-400/70 to-transparent" />
      </div>

      <div className="absolute -top-3 left-6 z-20 inline-flex items-center gap-1 rounded-full bg-green-400 px-3 py-1 text-xs font-semibold text-neutral-950 shadow-sm">
        <Zap className="h-3 w-3" aria-hidden />
        {pt.popular}
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{pt.advanced.name}</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{pt.advanced.description}</p>
        </div>

        <div className="mb-1">
          <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
            {formatMoney(prices.advancedMonthly)}
          </span>
          <span className="text-base text-neutral-700 dark:text-neutral-200">{pt.perMonth}</span>
        </div>
        {isAnnual ? (
          <p className="mb-4 text-xs text-neutral-700 dark:text-neutral-300">
            {pt.billedAnnually} {formatMoney(prices.advancedAnnualTotal)}
            {pt.perYear}
          </p>
        ) : (
          <div className="mb-4" />
        )}

        <div className="mb-6 rounded-xl border border-green-200/70 bg-white/70 p-4 backdrop-blur-sm dark:border-teal-800/60 dark:bg-neutral-950/40">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {pt.extraAccountLabel}
              </p>
              <p className="text-xs text-neutral-700 dark:text-neutral-300">
                {isAnnual ? pt.extraAccountUnitAnnual : pt.extraAccountUnit}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setExtraAccounts((v) => Math.max(0, v - 1))}
                disabled={extraAccounts === 0}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300/80 bg-white/80 text-neutral-900 transition-colors hover:bg-white disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                max={95}
                value={extraAccounts}
                onChange={(e) =>
                  setExtraAccounts(Math.max(0, Math.min(95, Number(e.target.value) || 0)))
                }
                className="h-8 w-14 rounded-md border border-neutral-300/80 bg-white text-center text-sm font-medium text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50"
                aria-label={pt.extraAccountLabel}
              />
              <button
                type="button"
                onClick={() => setExtraAccounts((v) => Math.min(95, v + 1))}
                disabled={extraAccounts >= 95}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300/80 bg-white/80 text-neutral-900 transition-colors hover:bg-white disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                +
              </button>
            </div>
          </div>
          {extraAccounts > 0 ? (
            <p className="mt-2 text-left text-xs text-neutral-700 dark:text-neutral-300">
              {interpolate(pt.extraAccountsSummary, {
                included: String(PRICING_ADVANCED_INCLUDED_ACCOUNTS),
                extra: String(extraAccounts),
                total: String(PRICING_ADVANCED_INCLUDED_ACCOUNTS + extraAccounts),
              })}
            </p>
          ) : null}
        </div>

        {planCta('advanced', isApp ? advancedCheckoutCta : pt.startTrial)}
        {featureList(pt.advancedFeatures)}
      </div>
    </div>
  )

  const customCardStacked = (
    <div className="relative rounded-2xl border border-neutral-200/65 bg-white p-8 shadow-xs dark:border-neutral-800/55 dark:bg-neutral-900">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{pt.custom.name}</h2>
        <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-50">{pt.custom.description}</p>
      </div>

      <div className="mb-6">
        <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">{pt.contactUs}</span>
      </div>

      {contactCta}
      {featureList(pt.customFeatures)}
    </div>
  )

  const customCardWide = (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200/65 bg-white p-8 shadow-xs dark:border-neutral-800/55 dark:bg-neutral-900 sm:p-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{pt.custom.name}</h2>
          <p className="mt-2 text-sm text-neutral-900 dark:text-neutral-50">{pt.custom.description}</p>
          <p className="mt-4 text-3xl font-bold text-neutral-900 dark:text-neutral-50">{pt.contactUs}</p>
          <div className="mt-6">{contactCta}</div>
        </div>
        <div className="min-w-0 flex-1 lg:max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-black dark:text-neutral-50">
            {pt.features}
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {pt.customFeatures.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden />
                <span className="text-sm text-black dark:text-neutral-50">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )

  return (
    <section className={sectionClass}>
      <div className={clsx('text-center', isApp && 'sr-only')}>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
          {lp.title}
        </h1>
        <p className="mt-3 text-base text-neutral-900 dark:text-neutral-50">{lp.subtitle}</p>
      </div>

      {checkoutError ? (
        <div
          role="alert"
          className="mx-auto mb-4 max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {checkoutError}
        </div>
      ) : null}

      <div className={clsx('flex justify-center', isApp ? 'mt-2' : 'mt-8')}>{intervalToggle}</div>

      {isApp ? (
        <div className="mt-10 space-y-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">{basicCard}{advancedCard}</div>
          {customCardWide}
        </div>
      ) : (
        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {basicCard}
          {advancedCard}
          {customCardStacked}
        </div>
      )}

      {/* Accepted methods: cards (Stripe) + crypto (NOWPayments) */}
      <PaymentAcceptedLogos label={pt.weAccept} />
    </section>
  )
}
