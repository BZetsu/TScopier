import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { CreditCard, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  createSetupIntent,
  detachPaymentMethod,
  listPaymentMethods,
  type SavedCardPaymentMethod,
} from '../../lib/planCheckout'
import { getStripe, getStripePublishableKey } from '../../lib/stripeClient'

function AddCardForm({
  onDone,
  onError,
  saveLabel,
}: {
  onDone: () => void
  onError: (message: string) => void
  saveLabel: string
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    onError('')
    try {
      const result = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}/billing?tab=payment_methods`,
        },
      })
      if (result.error) throw new Error(result.error.message || 'Could not save card')
      onDone()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save card')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <PaymentElement />
      <Button type="submit" className="w-full" loading={busy} disabled={!stripe || !elements}>
        {saveLabel}
      </Button>
    </form>
  )
}

export function PaymentMethodsPanel({
  accessToken,
  copy,
}: {
  accessToken: string
  copy: {
    title: string
    subtitle: string
    emptyTitle: string
    emptyHint: string
    addCard: string
    addCardHint: string
    saveCard: string
    removeCard: string
    footerNote: string
  }
}) {
  const [methods, setMethods] = useState<SavedCardPaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const stripePromise = useMemo(() => getStripe(), [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setMethods(await listPaymentMethods(accessToken))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payment methods')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startAdd = async () => {
    setError('')
    try {
      const secret = await createSetupIntent(accessToken)
      setClientSecret(secret)
      setAdding(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start add-card flow')
    }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await detachPaymentMethod(accessToken, id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove card')
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900 sm:p-8">
      <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">{copy.title}</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{copy.subtitle}</p>

      {error ? (
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-300" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-neutral-500">Loading…</p>
      ) : methods.length === 0 && !adding ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <CreditCard className="h-5 w-5" aria-hidden />
          </span>
          <p className="mt-3 font-semibold text-neutral-950 dark:text-neutral-50">{copy.emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">{copy.emptyHint}</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {methods.map((pm) => (
            <li
              key={pm.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-700"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-neutral-500" aria-hidden />
                <div>
                  <p className="text-sm font-medium capitalize text-neutral-950 dark:text-neutral-50">
                    {pm.brand} •••• {pm.last4}
                  </p>
                  {pm.expMonth && pm.expYear ? (
                    <p className="text-xs text-neutral-500">
                      {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(pm.id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {copy.removeCard}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && clientSecret && getStripePublishableKey() ? (
        <div className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <AddCardForm
              saveLabel={copy.saveCard}
              onError={setError}
              onDone={() => {
                setAdding(false)
                setClientSecret(null)
                void refresh()
              }}
            />
          </Elements>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void startAdd()}
          className="mt-6 flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-300 px-4 py-4 text-left transition-colors hover:border-neutral-400 dark:border-neutral-600"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-700">
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold text-neutral-950 dark:text-neutral-50">
              {copy.addCard}
            </span>
            <span className="block text-xs text-neutral-500">{copy.addCardHint}</span>
          </span>
        </button>
      )}

      <p className="mt-4 text-xs text-neutral-500">{copy.footerNote}</p>
    </div>
  )
}
