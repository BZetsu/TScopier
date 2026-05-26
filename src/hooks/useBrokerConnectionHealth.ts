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
 * Attempts reconnect before marking disconnected; ignores transient bridge blips.
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

  const connectedKey = useMemo(
    () =>
      brokers
        .filter(b => b.connection_status === 'connected' && isMtSessionUuid(b.metaapi_account_id))
        .map(b => b.id)
        .join(','),
    [brokers],
  )
  const connectedCount = connectedKey ? connectedKey.split(',').length : 0
  const baseIntervalMs = options?.baseIntervalMs ?? 20_000
  const pollIntervalMs = brokerHealthPollIntervalMs(connectedCount, baseIntervalMs)

  useEffect(() => {
    if (!enabled) return
    if (!connectedKey) return

    const connectedIds = connectedKey.split(',')
    let cancelled = false
    const activeIds = new Set(connectedIds)

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

    const verifyAll = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      for (const id of connectedIds) {
        if (cancelled) return
        try {
          await metatraderApi.check(id)
          failCountsRef.current.delete(id)
        } catch (err) {
          if (cancelled) return
          const msg = err instanceof Error ? err.message : String(err)
          if (isTransientBrokerHealthError(msg)) continue

          const prevFails = failCountsRef.current.get(id) ?? 0
          const nextFails = prevFails + 1
          failCountsRef.current.set(id, nextFails)

          if (isSessionDropMessage(msg) && nextFails >= 2) {
            const recovered = await attemptSilentReconnect(id)
            if (recovered) continue
          }

          if (nextFails < FAILURES_BEFORE_DISCONNECT) continue

          const recovered = await attemptSilentReconnect(id)
          if (!recovered && !cancelled) {
            applyReconnectFailure(setBrokers, id, msg, undefined)
          }
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
  }, [connectedKey, enabled, pollIntervalMs, refreshOnVisible, setBrokers])
}
