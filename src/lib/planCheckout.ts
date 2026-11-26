export type PlanCheckoutPaymentMethod = 'card' | 'crypto'

export async function startPlanCheckout(params: {
  accessToken: string
  plan: 'basic' | 'advanced'
  interval: 'monthly' | 'annual'
  extraAccounts?: number
  /** Hosted Checkout path is crypto-only in the redesigned flow. */
  paymentMethod?: PlanCheckoutPaymentMethod
  promotionCode?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<string> {
  // Crypto uses NOWPayments hosted invoice (Stripe crypto Checkout retired).
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-crypto-invoice`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan: params.plan,
      interval: params.interval,
      extraAccounts: params.plan === 'advanced' ? (params.extraAccounts ?? 0) : 0,
      successUrl: params.successUrl ?? `${window.location.origin}/dashboard?checkout=success`,
      cancelUrl: params.cancelUrl ?? `${window.location.origin}/billing`,
    }),
  })
  const data = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Checkout failed')
  }
  return data.url
}

export async function startCardSubscriptionElements(params: {
  accessToken: string
  plan: 'basic' | 'advanced'
  interval: 'monthly' | 'annual'
  extraAccounts?: number
  promotionCode?: string
}): Promise<{
  clientSecret: string
  subscriptionId: string
  intentType: 'payment' | 'setup'
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-subscription-elements`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan: params.plan,
      interval: params.interval,
      extraAccounts: params.plan === 'advanced' ? (params.extraAccounts ?? 0) : 0,
      promotionCode: params.promotionCode?.trim() || undefined,
    }),
  })
  const data = (await res.json()) as {
    clientSecret?: string
    subscriptionId?: string
    intentType?: 'payment' | 'setup'
    error?: string
  }
  if (!res.ok || !data.clientSecret || !data.subscriptionId) {
    throw new Error(data.error || 'Could not start card checkout')
  }
  return {
    clientSecret: data.clientSecret,
    subscriptionId: data.subscriptionId,
    intentType: data.intentType === 'setup' ? 'setup' : 'payment',
  }
}

/** Opens Stripe Checkout (setup mode) to add a card — same pattern as Copygram. */
export async function createSetupCheckout(accessToken: string): Promise<string> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-setup-intent`
  const returnTo = `${window.location.origin}/membership?tab=payment_methods`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      successUrl: `${returnTo}&setup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: returnTo,
    }),
  })
  const data = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Could not start add-card flow')
  }
  return data.url
}

export type SavedCardPaymentMethod = {
  id: string
  brand: string
  last4: string
  expMonth: number | null
  expYear: number | null
}

export async function listPaymentMethods(accessToken: string): Promise<SavedCardPaymentMethod[]> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-payment-methods`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const data = (await res.json()) as {
    paymentMethods?: SavedCardPaymentMethod[]
    error?: string
  }
  if (!res.ok) throw new Error(data.error || 'Could not load payment methods')
  return data.paymentMethods ?? []
}

export async function detachPaymentMethod(
  accessToken: string,
  paymentMethodId: string,
): Promise<void> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/detach-payment-method`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paymentMethodId }),
  })
  const data = (await res.json()) as { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not remove card')
}
