import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { whenRealtimeReady } from '../lib/whenRealtimeReady'
import { shouldRefreshActivitiesOnRealtimePayload } from '../lib/tradeActivities'

const DEBOUNCE_MS = 2000

/**
 * Subscribe to new trade_execution_logs rows for the Management page feed.
 * INSERT-only, ignores internal ticks, and pauses while the tab is hidden.
 */
export function useTradeActivitiesRealtime(
  userId: string | undefined,
  onDataChange: () => void,
): void {
  const onChangeRef = useRef(onDataChange)
  onChangeRef.current = onDataChange

  useEffect(() => {
    if (!userId) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pending = false
    let cancelled = false

    const flush = () => {
      debounceTimer = null
      if (typeof document !== 'undefined' && document.hidden) {
        pending = true
        return
      }
      pending = false
      onChangeRef.current()
    }

    const schedule = () => {
      pending = true
      if (typeof document !== 'undefined' && document.hidden) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, DEBOUNCE_MS)
    }

    const onVisibility = () => {
      if (typeof document === 'undefined' || document.hidden || !pending) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, 0)
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    const filter = `user_id=eq.${userId}`
    let channel: ReturnType<typeof supabase.channel> | null = null

    void whenRealtimeReady(userId).then(() => {
      if (cancelled) return
      channel = supabase
        .channel(`trade_activities:${userId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'trade_execution_logs', filter },
          payload => {
            const row = payload.new as { action?: unknown } | undefined
            if (!shouldRefreshActivitiesOnRealtimePayload(row)) return
            schedule()
          },
        )
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('[management] realtime subscription error')
          }
        })
    })

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (channel) void supabase.removeChannel(channel)
    }
  }, [userId])
}
