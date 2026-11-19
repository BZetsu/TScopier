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
    // Unique topic per hook instance — Dashboard mounts banner + status card
    // together; reusing `copier_listener_health:${userId}` throws
    // "cannot add postgres_changes callbacks … after subscribe()".
    const topic = `copier_listener_health:${userId}:${Math.random().toString(36).slice(2, 9)}`
    let rt: ReturnType<typeof supabase.channel> | null = null

    void whenRealtimeReady(userId).then(() => {
      if (cancelled) return
      const channel = supabase
        .channel(topic)
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
      rt = channel
      channel.subscribe()
      if (cancelled) {
        void supabase.removeChannel(channel)
        rt = null
      }
    })

    return () => {
      cancelled = true
      if (rt) void supabase.removeChannel(rt)
    }
  }, [userId, refresh])

  return { health, snapshots, loading, refresh }
}
