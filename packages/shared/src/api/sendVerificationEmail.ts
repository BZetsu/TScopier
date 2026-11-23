import { callEdgeFunction } from './edgeFetch'

/**
 * Sends the branded confirmation email via the send-verification-email edge function.
 * Works with or without a session (Supabase often omits session until email is confirmed).
 */
export async function sendVerificationEmail(args: {
  email: string
  accessToken?: string | null
  redirectTo: string
}): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await callEdgeFunction<{
    error?: string
    details?: string
    hint?: string
  }>('send-verification-email', {
    accessToken: args.accessToken ?? undefined,
    body: {
      email: args.email,
      redirectTo: args.redirectTo,
    },
  })
  if (!ok) {
    const msg = [data.error, data.details, data.hint].filter(Boolean).join(' — ')
    return { ok: false, error: msg || 'Request failed' }
  }
  return { ok: true }
}
