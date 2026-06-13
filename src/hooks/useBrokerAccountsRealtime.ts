import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { whenRealtimeReady } from '../lib/whenRealtimeReady'
import type { BrokerAccount } from '../types/database'
import { metatraderApi } from '../lib/metatraderapi'
import {
  brokerReconnectInFlight,
  endBrokerReconnect,
  tryBeginBrokerReconnect,
} from '../lib/brokerReconnectCoordinator'
import { sortBrokerAccountsNewestFirst } from '../lib/brokerAccountSelect'
import { isMtSessionUuid } from '../lib/brokerLink'

const RECONNECT_DEBOUNCE_MS = 3_000

/** Keep broker list in sync when the worker or edge function updates connection_status. */
export function useBrokerAccountsRealtime(
  userId: string | undefined,
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>,
  options?: { silentReconnect?: boolean },
): void {
  const reconnectTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const silentReconnect = options?.silentReconnect !== false

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void whenRealtimeReady(userId).then(() => {
      if (cancelled) return
      channel = supabase
        .channel(`broker_accounts:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'broker_accounts', filter: `user_id=eq.${userId}` },
          payload => {
            if (payload.eventType === 'DELETE') {
              const id = (payload.old as { id?: string }).id
              if (!id) return
              setBrokers(prev => prev.filter(b => b.id !== id))
              return
            }
            const row = payload.new as BrokerAccount | null
            if (!row?.id) return
            setBrokers(prev => {
              const idx = prev.findIndex(b => b.id === row.id)
              if (payload.eventType === 'INSERT') {
                if (idx >= 0) {
                  return prev.map(b => (b.id === row.id ? { ...b, ...row } : b))
                }
                return sortBrokerAccountsNewestFirst([...prev, row])
              }
              // UPDATE — do not re-add rows the user just removed locally.
              if (idx < 0) return prev
              return prev.map(b => (b.id === row.id ? { ...b, ...row } : b))
            })

            if (
              silentReconnect
              && row.connection_status === 'error'
              && isMtSessionUuid(row.metaapi_account_id)
              && !reconnectTimeouts.current.has(row.id)
              && !brokerReconnectInFlight(row.id)
            ) {
              const timeout = setTimeout(async () => {
                reconnectTimeouts.current.delete(row.id)
                if (!tryBeginBrokerReconnect(row.id)) return
                try {
                  const result = await metatraderApi.reconnect(row.id)
                  if (result.connection_status === 'connected') {
                    setBrokers(prev =>
                      prev.map(b => {
                        if (b.id !== row.id) return b
                        return {
                          ...b,
                          connection_status: 'connected' as const,
                          last_synced_at: new Date().toISOString(),
                          ...(result.summary
                            ? {
                                last_balance: result.summary.balance ?? b.last_balance,
                                last_equity: result.summary.equity ?? b.last_equity,
                                last_currency: result.summary.currency ?? b.last_currency,
                              }
                            : {}),
                        }
                      }),
                    )
                  }
                } catch {
                  // Silent — periodic loop will continue retrying
                } finally {
                  endBrokerReconnect(row.id)
                }
              }, RECONNECT_DEBOUNCE_MS)
              reconnectTimeouts.current.set(row.id, timeout)
            }
          },
        )
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('[broker_accounts] realtime subscription error')
          }
        })
    })

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
      for (const t of reconnectTimeouts.current.values()) clearTimeout(t)
      reconnectTimeouts.current.clear()
    }
  }, [userId, setBrokers, silentReconnect])
}
