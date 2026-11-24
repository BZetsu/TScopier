import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Button } from '../ui/Button'
import { confirmCheckoutSession } from '../../lib/confirmCheckout'
import { startCardSubscriptionElements } from '../../lib/planCheckout'
import { getStripe, getStripePublishableKey } from '../../lib/stripeClient'
import type { CheckoutSelection } from './CheckoutPaymentStep'

function InnerForm({
  accessToken,
  intentType,
  onSuccess,
  onError,
  onCancel,
  submitLabel,
}: {
  accessToken: string
  intentType: 'payment' | 'setup'
  onSuccess: () => void
  onError: (message: string) => void
  onCancel: () => void
  submitLabel: string
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    onError('')
    try {
      const return_url = `${window.location.origin}/dashboard?checkout=success`
      if (intentType === 'setup') {
        const setup = await stripe.confirmSetup({
          elements,
          redirect: 'if_required',
          confirmParams: { return_url },
        })
        if (setup.error) throw new Error(setup.error.message || 'Could not save card')
      } else {
        const result = await stripe.confirmPayment({
          elements,
          redirect: 'if_required',
          confirmParams: { return_url },
        })
        if (result.error) throw new Error(result.error.message || 'Payment failed')
      }
      await confirmCheckoutSession({ accessToken })
      onSuccess()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Payment failed')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <PaymentElement />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={submitting} disabled={!stripe || !elements}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function CardPaymentForm({
  accessToken,
  selection,
  promotionCode,
  planTitle,
  priceLabel,
  onSuccess,
  onError,
  onCancel,
}: {
  accessToken: string
  selection: CheckoutSelection
  promotionCode?: string
  planTitle: string
  priceLabel: string
  onSuccess: () => void
  onError: (message: string) => void
  onCancel: () => void
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [intentType, setIntentType] = useState<'payment' | 'setup'>('payment')
  const [loading, setLoading] = useState(true)
  const stripePromise = useMemo(() => getStripe(), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void startCardSubscriptionElements({
      accessToken,
      plan: selection.plan,
      interval: selection.interval,
      extraAccounts: selection.extraAccounts,
      promotionCode,
    })
      .then((data) => {
        if (cancelled) return
        setClientSecret(data.clientSecret)
        setIntentType(data.intentType)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        onError(err instanceof Error ? err.message : 'Could not start card checkout')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, selection, promotionCode, onError])

  if (!getStripePublishableKey()) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        Missing VITE_STRIPE_PUBLISHABLE_KEY. Set it in the environment and redeploy.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-xs dark:border-neutral-700 dark:bg-neutral-900 sm:p-8">
      <h2 className="text-xl font-bold text-neutral-950 dark:text-neutral-50">{planTitle}</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{priceLabel}</p>
      {loading || !clientSecret ? (
        <p className="mt-6 text-sm text-neutral-500">Preparing secure card form…</p>
      ) : (
        <div className="mt-6">
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: 'stripe' },
            }}
          >
            <InnerForm
              accessToken={accessToken}
              intentType={intentType}
              onSuccess={onSuccess}
              onError={onError}
              onCancel={onCancel}
              submitLabel={intentType === 'setup' ? 'Save card & start trial' : 'Pay now'}
            />
          </Elements>
        </div>
      )}
    </div>
  )
}
