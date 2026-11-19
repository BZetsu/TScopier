import type { PublicStatusPayload } from './publicStatusTypes'

export async function fetchPublicStatus(): Promise<PublicStatusPayload> {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
  if (!base || !anon) {
    throw new Error('Status service is not configured')
  }
  const res = await fetch(`${base}/functions/v1/public-status`, {
    method: 'GET',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
  })
  if (!res.ok) {
    throw new Error(`Status request failed (${res.status})`)
  }
  return (await res.json()) as PublicStatusPayload
}
