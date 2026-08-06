import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { useUserProfile } from './UserProfileContext'
import { supabase } from '../lib/supabase'
import { whenRealtimeReady } from '../lib/whenRealtimeReady'
import { playNotificationSound } from '../lib/notificationSound'
import { retrySignalApi } from '../lib/retrySignalApi'
import {
  HUMAN_REVIEW_SKIP_REASON,
  isHumanReviewSignal,
  reviewParsedLevels,
  reviewRemainingMs,
  type ReviewParsedLevels,
} from '../lib/humanReview'
import type { Signal } from '../types/database'

const FETCH_LIMIT = 50
const MAX_PENDING = 10

export type HumanReviewItem = {
  signal: Signal
  levels: ReviewParsedLevels
  remainingMs: number
}

interface HumanReviewContextValue {
  pending: HumanReviewItem[]
  approve: (signalId: string) => Promise<string | null>
  dismiss: (signalId: string) => void
}

const HumanReviewContext = createContext<HumanReviewContextValue | null>(null)

function toItem(signal: Signal): HumanReviewItem {
  return {
    signal,
    levels: reviewParsedLevels(signal),
    remainingMs: reviewRemainingMs(signal.created_at),
  }
}

export function HumanReviewProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const [pending, setPending] = useState<HumanReviewItem[]>([])
  const knownIdsRef = useRef(new Set<string>())
  const soundEnabled = profile.notification_sound_enabled !== false

  const upsert = useCallback((signal: Signal) => {
    setPending(prev => {
      if (!isHumanReviewSignal(signal)) return prev
      if (prev.some(item => item.signal.id === signal.id)) return prev
      const next = [toItem(signal), ...prev]
        .filter(item => item.remainingMs > 0)
        .slice(0, MAX_PENDING)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setPending([])
      knownIdsRef.current.clear()
      return
    }
    try {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'skipped')
        .ilike('skip_reason', `%${HUMAN_REVIEW_SKIP_REASON}%`)
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT)
      const fresh: HumanReviewItem[] = []
      knownIdsRef.current.clear()
      for (const s of (data ?? []) as Signal[]) {
        if (!isHumanReviewSignal(s)) continue
        const item = toItem(s)
        if (item.remainingMs <= 0) continue
        knownIdsRef.current.add(s.id)
        fresh.push(item)
      }
      setPending(fresh.slice(0, MAX_PENDING))
    } catch (err) {
      console.warn('[human-review] initial load failed', err)
    }
  }, [user?.id])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled || !user?.id) return
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null
    const filter = `user_id=eq.${user.id}`

    void whenRealtimeReady(user.id).then(() => {
      if (cancelled) return
      channel = supabase
        .channel(`human_review:${user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'signals', filter },
          payload => {
            const row = payload.new as Signal
            if (!isHumanReviewSignal(row)) return
            if (knownIdsRef.current.has(row.id)) return
            knownIdsRef.current.add(row.id)
            upsert(row)
            if (soundEnabled) playNotificationSound()
          },
        )
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('[human-review] realtime subscription error')
          }
        })
    })

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [enabled, user?.id, upsert, soundEnabled])

  const approve = useCallback(async (signalId: string): Promise<string | null> => {
    try {
      const result = await retrySignalApi.retry(signalId)
      if (!result.ok) return result.reason ?? 'unknown_error'
      setPending(prev => prev.filter(item => item.signal.id !== signalId))
      knownIdsRef.current.delete(signalId)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'unknown_error'
    }
  }, [])

  const dismiss = useCallback((signalId: string) => {
    setPending(prev => prev.filter(item => item.signal.id !== signalId))
    knownIdsRef.current.delete(signalId)
  }, [])

  const value = useMemo(
    (): HumanReviewContextValue => ({
      pending,
      approve,
      dismiss,
    }),
    [pending, approve, dismiss],
  )

  return <HumanReviewContext.Provider value={value}>{children}</HumanReviewContext.Provider>
}

export function useHumanReview(): HumanReviewContextValue {
  const ctx = useContext(HumanReviewContext)
  if (!ctx) {
    throw new Error('useHumanReview must be used within HumanReviewProvider')
  }
  return ctx
}
