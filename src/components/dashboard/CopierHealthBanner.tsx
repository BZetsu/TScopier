import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { useT } from '../../context/LocaleContext'
import { useCopierHealth } from '../../hooks/useCopierHealth'
import {
  deriveCopierHealthUi,
  shouldShowCopierHealthBanner,
} from '../../lib/copierHealthUi'
import { supabase } from '../../lib/supabase'
import { getCachedTgSession, setCachedTgSession } from '../../lib/telegramSessionCache'
import { Button } from '../ui/Button'

export interface CopierHealthBannerProps {
  className?: string
  /** When set (e.g. Channels page), use instead of navigating to /channels. */
  onReconnect?: () => void
  /** Extra refresh work after health re-fetch (e.g. reload channels). */
  onRefresh?: () => void | Promise<void>
}

/**
 * Warning when Telegram is linked but the listener is not receiving
 * (offline / linked-not-receiving / reconnect required). Driven by
 * `copier_listener_health` only — never lease freshness alone.
 */
export function CopierHealthBanner({
  className,
  onReconnect,
  onRefresh,
}: CopierHealthBannerProps) {
  const { user } = useAuth()
  const { hasActiveSubscription } = useSubscription()
  const t = useT()
  const ce = t.copierEnginePage
  const cs = t.dashboard.copierStatus
  const { health, refresh } = useCopierHealth(user?.id)
  const [hasTgSession, setHasTgSession] = useState(() => {
    if (!user?.id) return false
    return Boolean(getCachedTgSession(user.id))
  })
  const [refreshing, setRefreshing] = useState(false)

  const refreshTelegramSession = useCallback(async () => {
    if (!user?.id) {
      setHasTgSession(false)
      return
    }
    const { data } = await supabase
      .from('telegram_sessions')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
    const hasSession = Boolean(data)
    setHasTgSession(hasSession)
    setCachedTgSession(user.id, hasSession)
  }, [user?.id])

  useEffect(() => {
    void refreshTelegramSession()
  }, [refreshTelegramSession])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshTelegramSession()
      await refresh()
      await onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }

  const show = shouldShowCopierHealthBanner(health, {
    hasTelegramSession: hasTgSession,
    hasActiveSubscription,
  })
  if (!show) return null

  const ui = deriveCopierHealthUi(health, { hasTelegramSession: hasTgSession })
  const title =
    ui.bannerKind === 'reconnect_required'
      ? cs.reconnectRequired
      : ui.bannerKind === 'linked_not_receiving'
        ? ce.linkedNotReceiving
        : ce.listenerLeaseExpired
  const hint =
    ui.bannerKind === 'reconnect_required'
      ? cs.telegramReconnectMessage
      : ui.bannerKind === 'linked_not_receiving'
        ? cs.telegramLinkedNotReceivingMessage
        : ce.listenerLeaseExpiredHint

  return (
    <div
      className={clsx(
        'px-4 py-3 bg-warning-50 dark:bg-amber-950/40 border border-warning-200 dark:border-amber-800 rounded-xl text-sm text-warning-800 dark:text-amber-100 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-xs mt-0.5 opacity-90">{hint}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        <Button size="sm" variant="secondary" onClick={() => void handleRefresh()} loading={refreshing}>
          <RefreshCw className="w-3.5 h-3.5" />
          {t.common.refresh}
        </Button>
        {onReconnect ? (
          <Button size="sm" onClick={onReconnect}>
            {ce.reconnectTelegram}
          </Button>
        ) : (
          <Link
            to="/channels"
            className="inline-flex items-center justify-center rounded-lg bg-green-400 px-3 py-1.5 text-sm font-medium text-neutral-950 shadow-xs transition-all hover:bg-green-500 focus:outline-hidden focus:ring-2 focus:ring-green-400 focus:ring-offset-2"
          >
            {ce.reconnectTelegram}
          </Link>
        )}
      </div>
    </div>
  )
}

/** @deprecated Use CopierHealthBanner — lease-only offline is no longer the source of truth. */
export const ListenerLeaseOfflineBanner = CopierHealthBanner
