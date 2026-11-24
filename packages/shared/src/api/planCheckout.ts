import { callEdgeFunction } from './edgeFetch'

export async function startPlanCheckout(params: {
  accessToken: string
  plan: 'basic' | 'advanced'
  interval: 'monthly' | 'annual'
  extraAccounts?: number
  paymentMethod?: 'card' | 'crypto'
  promotionCode?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<string> {
  const { ok, data } = await callEdgeFunction<{ url?: string; error?: string }>(
    'create-checkout-session',
    {
      accessToken: params.accessToken,
      body: {
        plan: params.plan,
        interval: params.interval,
        extraAccounts: params.plan === 'advanced' ? (params.extraAccounts ?? 0) : 0,
        paymentMethod: params.paymentMethod ?? 'crypto',
        promotionCode: params.promotionCode?.trim() || undefined,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
      },
    },
  )
  if (!ok || !data.url) {
    throw new Error(data.error || 'Checkout failed')
  }
  return data.url
}

export async function openCustomerPortal(accessToken: string, returnUrl: string): Promise<string> {
  const { ok, data } = await callEdgeFunction<{ url?: string; error?: string }>(
    'customer-portal',
    {
      accessToken,
      body: { returnUrl },
    },
  )
  if (!ok || !data.url) {
    throw new Error(data.error || 'Could not open billing portal')
  }
  return data.url
}
