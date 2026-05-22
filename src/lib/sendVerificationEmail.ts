/**
 * Sends the branded confirmation email via the send-verification-email edge function.
 * Works with or without a session (Supabase often omits session until email is confirmed).
 */
export async function sendVerificationEmail(args: {
  email: string
  accessToken?: string | null
  redirectTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-verification-email`
  const redirectTo = args.redirectTo ?? `${window.location.origin}/dashboard`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
  if (args.accessToken) {
    headers.Authorization = `Bearer ${args.accessToken}`
  } else {
    headers.Authorization = `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: args.email,
      redirectTo,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    details?: string
    hint?: string
  }

  if (!res.ok) {
    const msg = [data.error, data.details, data.hint].filter(Boolean).join(' — ')
    return { ok: false, error: msg || `HTTP ${res.status}` }
  }

  return { ok: true }
}
