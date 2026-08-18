import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type TradeReportRow = {
  id: string
  symbol: string | null
  direction: string | null
  ticket: string | null
  broker_label: string | null
  entry_price: number | null
  sl: number | null
  tp: number | null
  lot_size: number | null
  category: string | null
  reason: string | null
  status: string
  created_at: string
}

export function useTradeReports(userId: string | undefined) {
  const [reports, setReports] = useState<TradeReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inflightRef = useRef(false)
  const hydratedUserRef = useRef<string | null>(null)
  const userIdRef = useRef(userId)

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const run = async () => {
      const uid = userIdRef.current
      if (!uid || inflightRef.current) return
      if (!opts?.force && hydratedUserRef.current === uid) return
      inflightRef.current = true
      if (opts?.force) setLoading(true)
      try {
        const { data, error: qErr } = await supabase
          .from('trade_reports')
          .select(
            'id,symbol,direction,ticket,broker_label,entry_price,sl,tp,lot_size,category,reason,status,created_at',
          )
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(100)
        if (userIdRef.current !== uid) return
        if (qErr) throw qErr
        setReports((data ?? []) as TradeReportRow[])
        setError(null)
        hydratedUserRef.current = uid
        setLoading(false)
      } catch (e) {
        if (userIdRef.current !== uid) return
        setError(e instanceof Error ? e.message : 'Failed to load trade reports')
        hydratedUserRef.current = uid
        setLoading(false)
      } finally {
        inflightRef.current = false
        if (userIdRef.current !== uid) {
          void run()
        }
      }
    }
    return run()
  }, [])

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReports([])
      hydratedUserRef.current = null
      setLoading(false)
      return
    }
    if (hydratedUserRef.current !== userId) {
      setLoading(true)
    }
    void load()
  }, [userId, load])

  return { reports, loading, error, refresh: () => void load({ force: true }) }
}