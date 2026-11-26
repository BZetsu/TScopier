import { useState } from 'react'
import clsx from 'clsx'
import { Check, CreditCard, Coins, Shield, Tag } from 'lucide-react'
import { Button } from '../ui/Button'
import { CardPaymentForm } from './CardPaymentForm'

export type CheckoutSelection = {
  plan: 'basic' | 'advanced'
  interval: 'monthly' | 'annual'
  extraAccounts: number
}

export type CheckoutCopy = {
  checkoutBadge: string
  subscribeTo: string
  howToPay: string
  cardTitle: string
  cardDescription: string
  cardFooter: string
  cryptoTitle: string
  cryptoDescription: string
  cryptoFooter: string
  addPromo: string
  promoPlaceholder: string
  applyPromo: string
  continueCheckout: string
  backToPlans: string
  perMonth: string
  perYear: string
  basicName: string
  advancedName: string
}

export function CheckoutPaymentStep({
  selection,
  priceLabel,
  accessToken,
  copy,
  successUrl,
  cancelUrl,
  initialPromo,
  onBack,
  onCardSuccess,
  onError,
}: {
  selection: CheckoutSelection
  priceLabel: string
  accessToken: string
  copy: CheckoutCopy
  successUrl: string
  cancelUrl: string
  initialPromo?: string
  onBack: () => void
  onCardSuccess: () => void
  onError: (message: string) => void
}) {
  const [method, setMethod] = useState<'card' | 'crypto'>('card')
  const [promoOpen, setPromoOpen] = useState(Boolean(initialPromo?.trim()))
  const [promoInput, setPromoInput] = useState(initialPromo?.trim() ?? '')
  const [promoApplied, setPromoApplied] = useState(initialPromo?.trim() ?? '')
  const [busy, setBusy] = useState(false)
  const [showCardForm, setShowCardForm] = useState(false)

  const planName = selection.plan === 'advanced' ? copy.advancedName : copy.basicName

  const continueCheckout = async () => {
    onError('')
    if (method === 'card') {
      setShowCardForm(true)
      return
    }
    setBusy(true)
    try {
      const { startPlanCheckout } = await import('../../lib/planCheckout')
      const url = await startPlanCheckout({
        accessToken,
        plan: selection.plan,
        interval: selection.interval,
        extraAccounts: selection.extraAccounts,
        paymentMethod: 'crypto',
        promotionCode: promoApplied || undefined,
        successUrl,
        cancelUrl,
      })
      window.location.href = url
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  if (showCardForm) {
    return (
      <div className="mx-auto max-w-xl">
        <button
          type="button"
          onClick={() => setShowCardForm(false)}
          className="mb-4 text-sm font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
        >
          ← {copy.backToPlans}
        </button>
        <CardPaymentForm
          accessToken={accessToken}
          selection={selection}
          promotionCode={promoApplied || undefined}
          planTitle={`${copy.subscribeTo} ${planName}`}
          priceLabel={priceLabel}
          onSuccess={onCardSuccess}
          onError={onError}
          onCancel={() => setShowCardForm(false)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-sm font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
      >
        ← {copy.backToPlans}
      </button>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-xs dark:border-neutral-700 dark:bg-neutral-900 sm:p-8">
        <span className="inline-flex rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          {copy.checkoutBadge}
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-50">
          {copy.subscribeTo} {planName}
        </h2>
        <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">{priceLabel}</p>

        <p className="mt-8 text-sm font-semibold text-neutral-950 dark:text-neutral-50">
          {copy.howToPay}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                id: 'card' as const,
                title: copy.cardTitle,
                description: copy.cardDescription,
                footer: copy.cardFooter,
                iconBg: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
                Icon: CreditCard,
                footerClass: 'text-neutral-500 dark:text-neutral-400',
              },
              {
                id: 'crypto' as const,
                title: copy.cryptoTitle,
                description: copy.cryptoDescription,
                footer: copy.cryptoFooter,
                iconBg: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
                Icon: Coins,
                footerClass: 'text-amber-700 dark:text-amber-400',
              },
            ] as const
          ).map((opt) => {
            const selected = method === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMethod(opt.id)}
                className={clsx(
                  'relative rounded-2xl border p-4 text-left transition-colors',
                  selected
                    ? 'border-teal-500 bg-teal-50/40 dark:border-teal-400 dark:bg-teal-950/30'
                    : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600',
                )}
              >
                {selected ? (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-white">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                ) : null}
                <span
                  className={clsx(
                    'inline-flex h-10 w-10 items-center justify-center rounded-xl',
                    opt.iconBg,
                  )}
                >
                  <opt.Icon className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-3 text-base font-semibold text-neutral-950 dark:text-neutral-50">
                  {opt.title}
                </p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {opt.description}
                </p>
                <p className={clsx('mt-3 flex items-start gap-1.5 text-xs', opt.footerClass)}>
                  <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{opt.footer}</span>
                </p>
              </button>
            )
          })}
        </div>

        <div className="mt-6">
          {!promoOpen ? (
            <button
              type="button"
              onClick={() => setPromoOpen(true)}
              className="w-full rounded-full border border-teal-200 px-4 py-2 text-sm font-medium text-teal-800 dark:border-teal-800 dark:text-teal-300"
            >
              — {copy.addPromo}
            </button>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  placeholder={copy.promoPlaceholder}
                  className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPromoApplied(promoInput.trim())}
              >
                {copy.applyPromo}
              </Button>
            </div>
          )}
          {promoApplied ? (
            <p className="mt-2 text-xs text-teal-700 dark:text-teal-300">
              {promoApplied}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          loading={busy}
          onClick={() => void continueCheckout()}
        >
          {copy.continueCheckout}
        </Button>
      </div>
    </div>
  )
}
