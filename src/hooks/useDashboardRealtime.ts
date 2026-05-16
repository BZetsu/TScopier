import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const DEBOUNCE_MS = 450

/**
 * Subscribe to Supabase Realtime for tables that drive dashboard stats.
 * Debounces bursts (e.g. multi-leg basket) into a single quiet refresh.
 */
export function useDashboardRealtime(
  userId: string | undefined,
  onDataChange: () => void,
): void {
  const onChangeRef = useRef(onDataChange)
  onChangeRef.current = onDataChange

  useEffect(() => {
    if (!userId) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        onChangeRef.current()
      }, DEBOUNCE_MS)
    }

    const filter = `user_id=eq.${userId}`
    const channel = supabase
      .channel(`dashboard_realtime:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades', filter },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signals', filter },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'broker_accounts', filter },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_execution_logs', filter },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'telegram_channels', filter },
        schedule,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[dashboard] realtime subscription error')
        }
      })

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      void supabase.removeChannel(channel)
    }
  }, [userId])
}
