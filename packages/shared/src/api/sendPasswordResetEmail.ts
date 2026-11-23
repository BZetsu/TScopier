import { callEdgeFunction } from './edgeFetch'

export async function sendPasswordResetEmail(args: {
  email: string
  redirectTo: string
}): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await callEdgeFunction<{ error?: string; details?: string }>(
    'send-password-reset-email',
    {
      body: {
        email: args.email,
        redirectTo: args.redirectTo,
      },
    },
  )
  if (!ok) {
    const msg = [data.error, data.details].filter(Boolean).join(' — ')
    return { ok: false, error: msg || 'Request failed' }
  }
  return { ok: true }
}
