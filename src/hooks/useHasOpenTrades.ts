import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { whenRealtimeReady } from '../lib/whenRealtimeReady'

const REFRESH_MS = 60_000
const REALTIME_DEBOUNCE_MS = 450

export function useHasOpenTrades(userId: string | undefined): boolean {
  const [hasOpen, setHasOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) {
      setHasOpen(false)
      return
    }
    const { count, error } = await supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open')

    if (error) {
      console.warn('[openTrades] count failed', error.message)
      return
    }
    setHasOpen((count ?? 0) > 0)
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void refresh()
      }, REALTIME_DEBOUNCE_MS)
    }

    const filter = `user_id=eq.${userId}`
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void whenRealtimeReady(userId).then(() => {
      if (cancelled) return
      channel = supabase
        .channel(`open_trades_indicator:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trades', filter },
          schedule,
        )
        .subscribe()
    })

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      window.clearInterval(interval)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  return hasOpen
}
