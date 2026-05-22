import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Zap } from 'lucide-react'
import { useT } from '../../context/LocaleContext'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'

const BASIC_FEATURES = [
  '1 demo/live account',
  '5 Signal Backtests/month',
  '5 Telegram Channels',
  '3 TPs',
  'Single Trading Mode',
  'Market News',
  'Economic Calendar',
  'Time/Days/News Filter',
]

const ADVANCED_FEATURES = [
  '5 demo/live accounts (expandable to 100)',
  'Unlimited signal backtests/month',
  'Unlimited Telegram Channels',
  'Unlimited TPs/SLs',
  'Single & Range Trading Mode',
  'Range Layering',
  'Close worse entries first',
  'Reverse signal',
  'Auto breakeven & close (Pips, Money, RR, TP Hit)',
  'Risk Reward Mode',
  'Market News',
  'Economic Calendar',
  'Time/Days/News Filter',
  'Channel Keyword follow',
]

export function PricingPage() {
  const t = useT()
  const pt = t.pricing
  const navigate = useNavigate()
  const { session } = useAuth()
  const [extraAccounts, setExtraAccounts] = useState(0)
  const [loadingPlan, setLoadingPlan] = useState<'basic' | 'advanced' | null>(null)

  const advancedTotal = 39.99 + extraAccounts * 10

  const handleCheckout = async (plan: 'basic' | 'advanced') => {
    setLoadingPlan(plan)
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan,
          extraAccounts: plan === 'advanced' ? extraAccounts : 0,
          successUrl: `${window.location.origin}/dashboard?checkout=success`,
          cancelUrl: `${window.location.origin}/pricing`,
        }),
      })

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
            {pt.title}
          </h1>
          <p className="mt-3 text-base text-neutral-500 dark:text-neutral-400">
            {pt.subtitle}
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-4 inline-block text-sm font-medium text-neutral-400 underline underline-offset-4 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
          >
            {pt.skip}
          </button>
        </div>

        {/* Plans */}
        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* Basic Plan */}
          <div className="relative rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                {pt.basic.name}
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {pt.basic.description}
              </p>
            </div>

            <div className="mb-8">
              <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">$9.99</span>
              <span className="text-base text-neutral-500 dark:text-neutral-400">{pt.perMonth}</span>
            </div>

            <Button
              size="lg"
              className="w-full"
              onClick={() => handleCheckout('basic')}
              loading={loadingPlan === 'basic'}
              disabled={loadingPlan !== null}
            >
              {pt.subscribe}
            </Button>

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {pt.features}
              </p>
              <ul className="mt-4 space-y-3">
                {BASIC_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Advanced Plan */}
          <div className="relative rounded-2xl border-2 border-teal-500 bg-white p-8 shadow-md dark:bg-neutral-900">
            <div className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-teal-500 px-3 py-1 text-xs font-semibold text-white">
              <Zap className="h-3 w-3" />
              {pt.popular}
            </div>

            <div className="mb-6">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                {pt.advanced.name}
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {pt.advanced.description}
              </p>
            </div>

            <div className="mb-4">
              <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
                ${advancedTotal.toFixed(2)}
              </span>
              <span className="text-base text-neutral-500 dark:text-neutral-400">{pt.perMonth}</span>
            </div>

            {/* Extra accounts selector */}
            <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    {pt.extraAccountLabel}
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    {pt.extraAccountUnit}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExtraAccounts((v) => Math.max(0, v - 1))}
                    disabled={extraAccounts === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={95}
                    value={extraAccounts}
                    onChange={(e) => setExtraAccounts(Math.max(0, Math.min(95, Number(e.target.value) || 0)))}
                    className="h-8 w-14 rounded-md border border-neutral-300 bg-white text-center text-sm font-medium text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50"
                  />
                  <button
                    type="button"
                    onClick={() => setExtraAccounts((v) => Math.min(95, v + 1))}
                    disabled={extraAccounts >= 95}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    +
                  </button>
                </div>
              </div>
              {extraAccounts > 0 && (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  5 included + {extraAccounts} extra = {5 + extraAccounts} total accounts
                </p>
              )}
            </div>

            <Button
              size="lg"
              className="w-full"
              onClick={() => handleCheckout('advanced')}
              loading={loadingPlan === 'advanced'}
              disabled={loadingPlan !== null}
            >
              {pt.startTrial}
            </Button>
            <p className="mt-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
              {pt.trialDays}
            </p>

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {pt.features}
              </p>
              <ul className="mt-4 space-y-3">
                {ADVANCED_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
