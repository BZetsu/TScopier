import type { SupabaseClient } from '@supabase/supabase-js'

let cachedUserId: string | null | undefined
let cachedPromise: Promise<void> | null = null

export function whenRealtimeReady(
  supabase: SupabaseClient,
  userId?: string | null,
): Promise<void> {
  const key = userId ?? null
  if (cachedPromise && cachedUserId === key) return cachedPromise

  cachedUserId = key
  cachedPromise = supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (session?.access_token) {
      await supabase.realtime.setAuth(session.access_token)
    }
  })

  return cachedPromise
}

export function invalidateRealtimeReadyCache(): void {
  cachedUserId = undefined
  cachedPromise = null
}
