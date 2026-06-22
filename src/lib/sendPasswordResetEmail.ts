/**
 * Sends a branded password-reset email via the send-password-reset-email edge function.
 */
export async function sendPasswordResetEmail(args: {
  email: string
  redirectTo: string
}): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-password-reset-email`

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      email: args.email,
      redirectTo: args.redirectTo,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    details?: string
  }

  if (!res.ok) {
    const msg = [data.error, data.details].filter(Boolean).join(' — ')
    return { ok: false, error: msg || `HTTP ${res.status}` }
  }

  return { ok: true }
}
