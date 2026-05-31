import { useState } from 'react'
import clsx from 'clsx'
import { Minus, Plus } from 'lucide-react'
import { useT } from '../../context/LocaleContext'
import { useAuth } from '../../context/AuthContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { interpolate } from '../../i18n/interpolate'
import { startPlanCheckout } from '../../lib/planCheckout'
import {
  PRICING_ADVANCED_INCLUDED_ACCOUNTS,
  billingTablePrices,
} from '../../lib/pricingPlans'

type PlanId = 'basic' | 'advanced'
type BillingInterval = 'monthly' | 'annual'

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function BillingPricingTable() {
  const t = useT()
  const pt = t.pricing
  const bt = pt.billing
  const { session } = useAuth()
  const { effectivePlan } = useSubscription()

  const [extraAccounts, setExtraAccounts] = useState(0)
  const [selectedInterval, setSelectedInterval] = useState<Record<PlanId, BillingInterval>>({
    basic: 'annual',
    advanced: 'annual',
  })
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState('')

  const prices = billingTablePrices(extraAccounts)

  const startCheckout = async (plan: PlanId) => {
    if (!session?.access_token || effectivePlan === plan) return
    const interval = selectedInterval[plan]
    const key = `${plan}-${interval}`
    setCheckoutError('')
    setCheckoutKey(key)
    try {
      const url = await startPlanCheckout({
        accessToken: session.access_token,
        plan,
        interval,
        extraAccounts: plan === 'advanced' ? extraAccounts : 0,
        cancelUrl: `${window.location.origin}/billing`,
      })
      window.location.href = url
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : pt.checkoutFailed)
      setCheckoutKey(null)
    }
  }

  const rows: Array<{
    id: PlanId
    name: string
    includes: string
    popular?: boolean
    trialNote?: boolean
  }> = [
    {
      id: 'basic',
      name: pt.basic.name,
      includes: pt.basic.description,
    },
    {
      id: 'advanced',
      name: pt.advanced.name,
      includes: interpolate(bt.pricingTableAdvancedIncludes, {
        count: String(PRICING_ADVANCED_INCLUDED_ACCOUNTS),
      }),
      popular: true,
      trialNote: true,
    },
  ]

  return (
    <div className="space-y-4">
      {checkoutError ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {checkoutError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-400">
                <th className="px-5 py-3">{bt.pricingTablePlans}</th>
                <th className="px-5 py-3">{bt.pricingTableIncludes}</th>
                <th className="px-5 py-3">{bt.pricingTableMonthly}</th>
                <th className="px-5 py-3 bg-teal-50/70 dark:bg-teal-950/20">
                  <span className="inline-flex items-center gap-2">
                    {bt.pricingTableAnnual}
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-teal-800 dark:bg-teal-900/50 dark:text-teal-200">
                      {bt.pricingTableBestValue}
                    </span>
                  </span>
                </th>
                <th className="px-5 py-3 text-right">{bt.pricingTableAction}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-200 bg-neutral-50/50 dark:border-neutral-800 dark:bg-neutral-800/30">
                <td
                  colSpan={5}
                  className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300"
                >
                  {bt.pricingTableCategory}
                </td>
              </tr>

              {rows.map(row => {
                const rowPrices = prices[row.id]
                const interval = selectedInterval[row.id]
                const isCurrent = effectivePlan === row.id
                const loading = checkoutKey === `${row.id}-${interval}`

                return (
                  <tr
                    key={row.id}
                    className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-800"
                  >
                    <td className="px-5 py-5 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-50">
                          {row.name}
                        </span>
                        {row.popular ? (
                          <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                            {pt.popular}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-5 py-5 align-top text-neutral-600 dark:text-neutral-300">
                      <p>{row.includes}</p>
                      {row.id === 'advanced' ? (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                            {pt.extraAccountLabel}:
                          </span>
                          <button
                            type="button"
                            onClick={() => setExtraAccounts(v => Math.max(0, v - 1))}
                            disabled={extraAccounts === 0 || checkoutKey !== null}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-[1.5rem] text-center text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                            {extraAccounts}
                          </span>
                          <button
                            type="button"
                            onClick={() => setExtraAccounts(v => Math.min(95, v + 1))}
                            disabled={extraAccounts >= 95 || checkoutKey !== null}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </td>

                    <td className="px-5 py-5 align-top">
                      <button
                        type="button"
                        onClick={() => setSelectedInterval(prev => ({ ...prev, [row.id]: 'monthly' }))}
                        className={clsx(
                          'rounded-lg px-2 py-1 text-left transition-colors',
                          interval === 'monthly'
                            ? 'ring-2 ring-teal-500/40 bg-teal-50/50 dark:bg-teal-950/30'
                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                        )}
                      >
                        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                          {formatMoney(rowPrices.monthly)}
                        </p>
                      </button>
                    </td>

                    <td className="px-5 py-5 align-top bg-teal-50/40 dark:bg-teal-950/15">
                      <button
                        type="button"
                        onClick={() => setSelectedInterval(prev => ({ ...prev, [row.id]: 'annual' }))}
                        className={clsx(
                          'rounded-lg px-2 py-1 text-left transition-colors',
                          interval === 'annual'
                            ? 'ring-2 ring-teal-500/40 bg-teal-50/80 dark:bg-teal-950/40'
                            : 'hover:bg-teal-50/60 dark:hover:bg-teal-950/25',
                        )}
                      >
                        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                          {formatMoney(rowPrices.annualTotal)}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          {interpolate(bt.pricingTableSave, {
                            amount: formatMoney(rowPrices.annualSavings),
                          })}
                        </p>
                      </button>
                    </td>

                    <td className="px-5 py-5 align-top text-right">
                      <button
                        type="button"
                        disabled={isCurrent || checkoutKey !== null}
                        onClick={() => void startCheckout(row.id)}
                        className={clsx(
                          'inline-flex min-w-[7rem] items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                          isCurrent
                            ? 'cursor-default bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                            : 'bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-950/70',
                          loading && 'opacity-70',
                        )}
                      >
                        {loading
                          ? t.common.loading
                          : isCurrent
                            ? bt.currentPlan
                            : bt.pricingTablePurchase}
                      </button>
                      {row.trialNote && !isCurrent ? (
                        <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                          {pt.trialDays}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {bt.pricingTableHint}
      </p>
    </div>
  )
}
