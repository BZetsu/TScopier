import clsx from 'clsx'
import { Activity, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import { isBrokerSessionHealthy } from '../../lib/brokerReconnect'
import { isFxsocketLinkedBroker } from '../../lib/brokerLink'
import {
  fetchListenerLeaseStatus,
  type ListenerLeaseSnapshot,
} from '../../lib/listenerLeaseStatus'
import { supabase } from '../../lib/supabase'
import { getCachedTgSession, setCachedTgSession } from '../../lib/telegramSessionCache'
import type { BrokerAccount } from '../../types/database'

const EXPANDED_STORAGE_KEY = 'tscopier.dashboard.copierStatusExpanded'

type Tone = 'ok' | 'warn' | 'bad' | 'muted'

function readExpandedPreference(defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* ignore */
  }
  return defaultValue
}

function StatusValue({ children, tone }: { children: string; tone: Tone }) {
  return (
    <span
      className={clsx(
        'font-medium tabular-nums',
        tone === 'ok' && 'text-teal-600 dark:text-teal-400',
        tone === 'warn' && 'text-amber-600 dark:text-amber-400',
        tone === 'bad' && 'text-rose-600 dark:text-rose-400',
        tone === 'muted' && 'text-neutral-500 dark:text-neutral-400',
      )}
    >
      {children}
    </span>
  )
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: Tone
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="text-sm text-neutral-600 dark:text-neutral-400">{label}</span>
      <StatusValue tone={tone}>{value}</StatusValue>
    </div>
  )
}

export function CopierStatusCard({
  accounts,
  className,
  /** When true, omit outer card chrome (for embedding in the balance section). */
  embedded = false,
  defaultExpanded = true,
}: {
  accounts: BrokerAccount[]
  className?: string
  embedded?: boolean
  defaultExpanded?: boolean
}) {
  const { user } = useAuth()
  const t = useT()
  const cs = t.dashboard.copierStatus
  const ce = t.copierEnginePage

  const [expanded, setExpanded] = useState(() => readExpandedPreference(defaultExpanded))
  const [hasTgSession, setHasTgSession] = useState(() => {
    if (!user?.id) return false
    return Boolean(getCachedTgSession(user.id))
  })
  const [listenerLease, setListenerLease] = useState<ListenerLeaseSnapshot>({
    status: 'unknown',
    expiresAt: null,
  })

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const refreshListenerLease = useCallback(async () => {
    if (!user?.id) return
    const snap = await fetchListenerLeaseStatus(supabase, user.id)
    setListenerLease(snap)
  }, [user?.id])

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

  useEffect(() => {
    if (!user?.id) {
      setListenerLease({ status: 'unknown', expiresAt: null })
      return
    }
    void refreshListenerLease()
    const interval = setInterval(() => void refreshListenerLease(), 30_000)
    return () => clearInterval(interval)
  }, [user?.id, refreshListenerLease])

  const { brokerConnectionsLabel, brokerConnectionsTone, brokerErrorCount } = useMemo(() => {
    const linked = accounts.filter(isFxsocketLinkedBroker)
    const activeLinked = linked.filter(a => a.is_active !== false)
    const errors = activeLinked.filter(a => !isBrokerSessionHealthy(a)).length

    if (activeLinked.length === 0) {
      return {
        brokerConnectionsLabel: cs.none,
        brokerConnectionsTone: 'muted' as Tone,
        brokerErrorCount: 0,
      }
    }
    if (errors === 0) {
      return {
        brokerConnectionsLabel: cs.healthy,
        brokerConnectionsTone: 'ok' as Tone,
        brokerErrorCount: 0,
      }
    }
    return {
      brokerConnectionsLabel: cs.issues,
      brokerConnectionsTone: 'bad' as Tone,
      brokerErrorCount: errors,
    }
  }, [accounts, cs.healthy, cs.issues, cs.none])

  const engine =
    listenerLease.status === 'live'
      ? { label: cs.live, tone: 'ok' as Tone }
      : listenerLease.status === 'unknown'
        ? { label: cs.checking, tone: 'muted' as Tone }
        : { label: cs.offline, tone: 'bad' as Tone }

  const telegram = hasTgSession
    ? { label: cs.online, tone: 'ok' as Tone }
    : { label: cs.offline, tone: 'bad' as Tone }

  const hasIssues =
    brokerConnectionsTone === 'bad' ||
    engine.tone === 'bad' ||
    telegram.tone === 'bad' ||
    brokerErrorCount > 0
  const isChecking = !hasIssues && engine.tone === 'muted'
  const collapsedSummaryTone: Tone = hasIssues ? 'bad' : isChecking ? 'muted' : 'ok'

  const collapsedSummary =
    collapsedSummaryTone === 'bad'
      ? cs.checksFailed
      : collapsedSummaryTone === 'muted'
        ? cs.checking
        : cs.allChecksPassed

  return (
    <div
      className={clsx(
        !embedded &&
          'bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800',
        className,
      )}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className={clsx(
          'w-full px-4 sm:px-5 py-3.5 flex items-center gap-2 text-left',
          'hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40 transition-colors',
          expanded && 'border-b border-neutral-100 dark:border-neutral-800',
        )}
      >
        <Activity className="w-4 h-4 text-teal-500 shrink-0" />
        {!expanded ? (
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold text-neutral-900 dark:text-neutral-50">
              {cs.title}:{' '}
            </span>
            <StatusValue tone={collapsedSummaryTone}>{collapsedSummary}</StatusValue>
          </span>
        ) : (
          <>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 shrink-0">
              {cs.title}
            </span>
            <span className="flex-1" />
          </>
        )}
        <ChevronDown
          className={clsx(
            'w-4 h-4 text-neutral-400 shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
        <span className="sr-only">{expanded ? ce.collapse : ce.expand}</span>
      </button>

      {expanded ? (
        <div className="px-4 sm:px-5 py-3 divide-y divide-neutral-100 dark:divide-neutral-800 sm:grid sm:grid-cols-2 sm:gap-x-10 sm:divide-y-0">
          <StatusRow
            label={cs.allBrokerConnections}
            value={brokerConnectionsLabel}
            tone={brokerConnectionsTone}
          />
          <StatusRow label={cs.copierEngine} value={engine.label} tone={engine.tone} />
          <StatusRow label={cs.telegramListener} value={telegram.label} tone={telegram.tone} />
          <StatusRow
            label={cs.brokerErrors}
            value={String(brokerErrorCount)}
            tone={brokerErrorCount > 0 ? 'bad' : 'ok'}
          />
        </div>
      ) : null}
    </div>
  )
}
