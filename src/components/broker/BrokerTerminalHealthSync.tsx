import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useBrokerAccounts } from '../../context/BrokerAccountsContext'
import { BrokerHealthCheckUnsupportedError, fxsocketBroker } from '../../lib/fxsocketBroker'
import { hasFxsocketBrokerSession } from '../../lib/brokerLink'
import { routeNeedsLiveBrokerConnectivity } from '../../lib/liveBrokerRoutes'

const HEALTH_POLL_INTERVAL_MS = 45_000

/** Poll FxSocket /Status for broker terminal health on live dashboard routes. */
export function BrokerTerminalHealthSync() {
  const { user } = useAuth()
  const location = useLocation()
  const { brokers, upsertBroker, healthPollingPaused } = useBrokerAccounts()

  const brokerIdsKey = useMemo(
    () => brokers
      .filter(b => {
        if (!hasFxsocketBrokerSession(b)) return false
        if (b.connection_status === 'pending') return false
        if (b.fxsocket_status === 'connecting') return false
        return true
      })
      .map(b => b.id)
      .sort()
      .join(','),
    [brokers],
  )

  const shouldPoll = Boolean(
    user?.id
    && brokerIdsKey
    && routeNeedsLiveBrokerConnectivity(location.pathname)
    && !healthPollingPaused,
  )
  const terminalHealthSupportedRef = useRef(true)

  useEffect(() => {
    if (!shouldPoll || !terminalHealthSupportedRef.current) return

    let cancelled = false

    const syncHealth = async () => {
      for (const id of brokerIdsKey.split(',')) {
        if (cancelled || !id || !terminalHealthSupportedRef.current) continue
        try {
          const { account } = await fxsocketBroker.checkStatus(id)
          if (cancelled) return
          upsertBroker(account)
        } catch (err) {
          if (err instanceof BrokerHealthCheckUnsupportedError) {
            terminalHealthSupportedRef.current = false
            return
          }
          // Next interval retries for transient errors.
        }
      }
    }

    void syncHealth()
    const timer = window.setInterval(() => void syncHealth(), HEALTH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [brokerIdsKey, shouldPoll, upsertBroker])

  return null
}
