/** Confirm Stripe Checkout and sync local subscription entitlement. */
export async function confirmCheckoutSession(params: {
  accessToken: string
  sessionId?: string | null
}): Promise<{ ok: boolean; entitlement?: { plan: string; status: string } | null }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-checkout`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: params.sessionId || undefined,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    entitlement?: { plan: string; status: string } | null
    error?: string
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error || 'Failed to confirm checkout')
  }
  return { ok: Boolean(data.ok), entitlement: data.entitlement ?? null }
}
