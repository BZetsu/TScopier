import { useCallback, useEffect, useState } from 'react'
import {
  copierHealthFromRow,
  fetchCopierHealthStatus,
  type CopierHealthSnapshot,
} from '../lib/copierHealthStatus'
import { supabase } from '../lib/supabase'
import { whenRealtimeReady } from '../lib/whenRealtimeReady'

const POLL_MS = 30_000

export type UseCopierHealthResult = {
  health: CopierHealthSnapshot
  /** Completed server fetches (0 until first response). */
  snapshots: number
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Single source of truth for dashboard Telegram / copier process health.
 * Reads `copier_listener_health` (poll + realtime). Does not use leases.
 */
export function useCopierHealth(userId: string | null | undefined): UseCopierHealthResult {
  const [health, setHealth] = useState<CopierHealthSnapshot>(() => copierHealthFromRow(null))
  const [snapshots, setSnapshots] = useState(0)
  const [loading, setLoading] = useState(Boolean(userId))

  const refresh = useCallback(async () => {
    if (!userId) {
      setHealth(copierHealthFromRow(null))
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snap = await fetchCopierHealthStatus(supabase, userId)
      setHealth(snap)
      setSnapshots(count => count + 1)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setHealth(copierHealthFromRow(null))
      setSnapshots(0)
      setLoading(false)
      return
    }
    void refresh()
    const interval = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(interval)
  }, [userId, refresh])

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    let rt: ReturnType<typeof supabase.channel> | null = null

    void whenRealtimeReady(userId).then(() => {
      if (cancelled) return
      rt = supabase
        .channel(`copier_listener_health:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'copier_listener_health',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const row = (payload.new ?? null) as Record<string, unknown> | null
            if (!row || typeof row !== 'object') {
              void refresh()
              return
            }
            setHealth(copierHealthFromRow(row))
            setSnapshots(count => count + 1)
          },
        )
        .subscribe()
    })

    return () => {
      cancelled = true
      if (rt) void supabase.removeChannel(rt)
    }
  }, [userId, refresh])

  return { health, snapshots, loading, refresh }
}
