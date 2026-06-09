import { useEffect, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BrokerAccount } from '../types/database'
import { isMtSessionUuid } from '../lib/brokerLink'
import { brokerCanReconnect } from '../lib/brokerReconnect'
import { metatraderApi } from '../lib/metatraderapi'

const RECOVERY_INTERVAL_MS = 30_000
const SAME_SERVER_GAP_MS = 1500

function mtServerKey(broker: BrokerAccount): string {
  return `${broker.platform}:${(broker.broker_server ?? broker.id).trim().toLowerCase()}`
}

interface UseBrokerConnectionRecoveryOptions {
  enabled?: boolean
}

/**
 * Proactively reconnect disconnected MT sessions (especially with stored credentials).
 * Runs even on Account Configuration so dropped sessions recover without manual clicks.
 */
export function useBrokerConnectionRecovery(
  brokers: BrokerAccount[],
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>,
  options?: UseBrokerConnectionRecoveryOptions,
): void {
  const recoveringRef = useRef(new Set<string>())
  const enabled = options?.enabled ?? true

  const targets = useMemo(
    () =>
      brokers
        .filter(b => brokerCanReconnect(b) && isMtSessionUuid(b.metaapi_account_id))
        .sort((a, b) => mtServerKey(a).localeCompare(mtServerKey(b))),
    [brokers],
  )

  const targetKey = useMemo(() => targets.map(b => b.id).join(','), [targets])

  useEffect(() => {
    if (!enabled || !targetKey) return

    let cancelled = false

    const recoverOne = async (broker: BrokerAccount): Promise<void> => {
      if (recoveringRef.current.has(broker.id)) return
      recoveringRef.current.add(broker.id)
      try {
        const result = await metatraderApi.reconnect(broker.id)
        if (cancelled || result.connection_status !== 'connected') return
        setBrokers(prev =>
          prev.map(b => {
            if (b.id !== broker.id) return b
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
      } catch {
        // Silent — next sweep retries
      } finally {
        recoveringRef.current.delete(broker.id)
      }
    }

    const runSweep = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      let lastServerKey: string | null = null
      for (const broker of targets) {
        if (cancelled) return
        const serverKey = mtServerKey(broker)
        if (lastServerKey === serverKey) {
          await new Promise(r => setTimeout(r, SAME_SERVER_GAP_MS))
        }
        lastServerKey = serverKey
        await recoverOne(broker)
        await new Promise(r => setTimeout(r, 600))
      }
    }

    void runSweep()
    const timer = window.setInterval(() => {
      void runSweep()
    }, RECOVERY_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSweep()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, setBrokers, targetKey, targets])
}
