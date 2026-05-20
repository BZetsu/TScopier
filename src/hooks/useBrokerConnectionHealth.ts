import { useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BrokerAccount } from '../types/database'
import { isMtSessionUuid } from '../lib/brokerLink'
import { metatraderApi } from '../lib/metatraderapi'

const DEFAULT_INTERVAL_MS = 20_000

/**
 * Periodically verify brokers marked "connected" can actually reach trading APIs.
 * CheckConnect alone is insufficient — the edge check uses verifyTradingReady.
 */
export function useBrokerConnectionHealth(
  brokers: BrokerAccount[],
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>,
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  const connectedIds = useMemo(
    () =>
      brokers
        .filter(b => b.connection_status === 'connected' && isMtSessionUuid(b.metaapi_account_id))
        .map(b => b.id),
    [brokers],
  )
  const connectedKey = connectedIds.join(',')

  useEffect(() => {
    if (!connectedKey) return

    let cancelled = false

    const verifyAll = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      for (const id of connectedIds) {
        try {
          await metatraderApi.check(id)
        } catch {
          if (cancelled) return
          setBrokers(prev =>
            prev.map(b => (b.id === id ? { ...b, connection_status: 'error' as const } : b)),
          )
        }
      }
    }

    void verifyAll()
    const timer = window.setInterval(() => {
      void verifyAll()
    }, intervalMs)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void verifyAll()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connectedKey, connectedIds, intervalMs, setBrokers])
}
