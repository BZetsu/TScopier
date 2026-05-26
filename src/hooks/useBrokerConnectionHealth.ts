import { useEffect, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BrokerAccount } from '../types/database'
import { isMtSessionUuid } from '../lib/brokerLink'
import {
  brokerHealthPollIntervalMs,
  isSessionDropMessage,
  isTransientBrokerHealthError,
} from '../lib/brokerHealthCheck'
import { classifyBrokerConnectError } from '../lib/brokerConnectError'
import { metatraderApi } from '../lib/metatraderapi'

const FAILURES_BEFORE_DISCONNECT = 3
const SAME_SERVER_GAP_MS = 1500

function mtServerKey(broker: BrokerAccount): string {
  return `${broker.platform}:${(broker.broker_server ?? broker.id).trim().toLowerCase()}`
}

interface UseBrokerConnectionHealthOptions {
  enabled?: boolean
  baseIntervalMs?: number
  refreshOnVisible?: boolean
}

function applyReconnectFailure(
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>,
  brokerId: string,
  message: string | undefined,
  connectionErrorKind: string | undefined,
) {
  setBrokers(prev =>
    prev.map(b => {
      if (b.id !== brokerId) return b
      const kind = connectionErrorKind ?? classifyBrokerConnectError(message)
      return {
        ...b,
        connection_status: 'error' as const,
        connection_error_kind: kind,
        connection_error_message: message ?? b.connection_error_message ?? null,
      }
    }),
  )
}

/**
 * Periodically verify brokers marked "connected" can actually reach trading APIs.
 * Accounts on the same MT server are checked sequentially to avoid MetatraderAPI conflicts.
 */
export function useBrokerConnectionHealth(
  brokers: BrokerAccount[],
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>,
  options?: UseBrokerConnectionHealthOptions,
): void {
  const failCountsRef = useRef(new Map<string, number>())
  const reconnectingRef = useRef(new Set<string>())
  const enabled = options?.enabled ?? true
  const refreshOnVisible = options?.refreshOnVisible ?? true

  const connectedBrokers = useMemo(
    () =>
      brokers.filter(b => b.connection_status === 'connected' && isMtSessionUuid(b.metaapi_account_id)),
    [brokers],
  )

  const connectedKey = useMemo(
    () => connectedBrokers.map(b => b.id).join(','),
    [connectedBrokers],
  )
  const connectedCount = connectedBrokers.length
  const baseIntervalMs = options?.baseIntervalMs ?? 20_000
  const pollIntervalMs = brokerHealthPollIntervalMs(connectedCount, baseIntervalMs)

  const sortedForHealth = useMemo(
    () =>
      [...connectedBrokers].sort((a, b) => mtServerKey(a).localeCompare(mtServerKey(b))),
    [connectedBrokers],
  )

  useEffect(() => {
    if (!enabled) return
    if (!connectedKey) return

    let cancelled = false
    const activeIds = new Set(connectedKey.split(','))

    const attemptSilentReconnect = async (brokerId: string): Promise<boolean> => {
      if (reconnectingRef.current.has(brokerId)) return false
      reconnectingRef.current.add(brokerId)
      try {
        const result = await metatraderApi.reconnect(brokerId)
        if (cancelled) return false
        if (result.connection_status === 'connected') {
          failCountsRef.current.delete(brokerId)
          setBrokers(prev =>
            prev.map(b => {
              if (b.id !== brokerId) return b
              return {
                ...b,
                connection_status: 'connected' as const,
                connection_error_kind: null,
                connection_error_message: null,
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
          return true
        }
        applyReconnectFailure(
          setBrokers,
          brokerId,
          result.message,
          result.connection_error_kind,
        )
        return false
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          applyReconnectFailure(setBrokers, brokerId, msg, undefined)
        }
        return false
      } finally {
        reconnectingRef.current.delete(brokerId)
      }
    }

    const handleCheckFailure = async (id: string, msg: string) => {
      if (cancelled) return
      if (isTransientBrokerHealthError(msg)) return

      const prevFails = failCountsRef.current.get(id) ?? 0
      const nextFails = prevFails + 1
      failCountsRef.current.set(id, nextFails)

      if (isSessionDropMessage(msg) && nextFails >= 2) {
        const recovered = await attemptSilentReconnect(id)
        if (recovered) return
      }

      if (nextFails < FAILURES_BEFORE_DISCONNECT) return

      const recovered = await attemptSilentReconnect(id)
      if (!recovered && !cancelled) {
        applyReconnectFailure(setBrokers, id, msg, undefined)
      }
    }

    const verifyAll = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      let lastServerKey: string | null = null
      for (const broker of sortedForHealth) {
        if (cancelled) return
        const serverKey = mtServerKey(broker)
        if (lastServerKey === serverKey) {
          await new Promise(r => setTimeout(r, SAME_SERVER_GAP_MS))
        }
        lastServerKey = serverKey

        try {
          const { connected, message } = await metatraderApi.check(broker.id)
          if (connected) {
            failCountsRef.current.delete(broker.id)
          } else {
            await handleCheckFailure(broker.id, message ?? 'Broker session is not connected')
          }
        } catch (err) {
          await handleCheckFailure(broker.id, err instanceof Error ? err.message : String(err))
        }
        await new Promise(r => setTimeout(r, 800))
      }
    }

    for (const id of [...failCountsRef.current.keys()]) {
      if (!activeIds.has(id)) failCountsRef.current.delete(id)
    }

    void verifyAll()
    const timer = window.setInterval(() => {
      void verifyAll()
    }, pollIntervalMs)

    const onVisible = () => {
      if (refreshOnVisible && document.visibilityState === 'visible') void verifyAll()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connectedKey, enabled, pollIntervalMs, refreshOnVisible, setBrokers, sortedForHealth])
}
