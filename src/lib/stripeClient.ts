import { loadStripe, type Stripe } from '@stripe/stripe-js'

let stripePromise: Promise<Stripe | null> | null = null

export function getStripePublishableKey(): string {
  return String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim()
}

/** Lazy Stripe.js loader for Elements (card subscribe + add card). */
export function getStripe(): Promise<Stripe | null> {
  const key = getStripePublishableKey()
  if (!key) return Promise.resolve(null)
  if (!stripePromise) stripePromise = loadStripe(key)
  return stripePromise
}
