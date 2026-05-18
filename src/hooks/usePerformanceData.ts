import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DASHBOARD_MT_HISTORY_DAYS, resolveDashboardChartTrades } from '../lib/dashboardCharts'
import {
  computeLinkedAccountPerformanceMap,
  getLocalCalendarDayBounds,
} from '../lib/dashboardTradeStats'
import { formatLocalCalendarDay } from '../lib/dayStartBalance'
import { formatLocalMtApiDateTime } from '../lib/mtApiDateTime'
import { metatraderApi, type MtTrade } from '../lib/metatraderapi'
import {
  aggregateAccountPerformance,
  chartTradesToStatsRows,
  computePeriodStatsFromChartTrades,
  computePeriodTradeStats,
  mtTradesToStatsRows,
  type PerformancePeriod,
} from '../lib/performanceAnalytics'
import type { BrokerAccount } from '../types/database'

function isMtLinkedBroker(account: BrokerAccount): boolean {
  const uuid = (account.metaapi_account_id ?? '').trim()
  return account.is_active && uuid.length > 0 && !uuid.includes('|')
}

export function usePerformanceData(userId: string | undefined) {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([])
  const [mtTrades, setMtTrades] = useState<MtTrade[]>([])
  const [equityByAccountId, setEquityByAccountId] = useState<Record<string, number>>({})
  const [balanceByAccountId, setBalanceByAccountId] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const inflightRef = useRef(false)
  const mtTradesRef = useRef<MtTrade[]>([])

  const load = useCallback(
    async (isRefresh = false) => {
      if (!userId || inflightRef.current) return
      inflightRef.current = true
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const brokerRes = await supabase
          .from('broker_accounts')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
        if (brokerRes.error) throw brokerRes.error

        const linked = (brokerRes.data ?? []) as BrokerAccount[]
        const mtBrokers = linked.filter(isMtLinkedBroker)

        let trades: MtTrade[] = []
        if (mtBrokers.length > 0) {
          const { tomorrowStart: historyTo } = getLocalCalendarDayBounds()
          const historyFrom = new Date()
          historyFrom.setDate(historyFrom.getDate() - DASHBOARD_MT_HISTORY_DAYS)
          try {
            const tradesRes = await metatraderApi.trades({
              scope: 'all',
              historyFrom: formatLocalMtApiDateTime(historyFrom),
              historyTo: formatLocalMtApiDateTime(historyTo),
            })
            trades = tradesRes.trades ?? []
          } catch (e) {
            throw e instanceof Error ? e : new Error('Failed to load broker trade history')
          }
        }

        if (trades.length > 0) {
          mtTradesRef.current = trades
          setMtTrades(trades)
        } else if (!isRefresh || mtTradesRef.current.length === 0) {
          mtTradesRef.current = trades
          setMtTrades(trades)
        }

        const calendarDay = formatLocalCalendarDay()
        const timezoneOffsetMinutes = new Date().getTimezoneOffset()
        const equity: Record<string, number> = {}
        const balance: Record<string, number> = {}
        const baselineById: Record<string, number> = {}

        await Promise.all(
          linked.map(async account => {
            if (!isMtLinkedBroker(account)) {
              const eq = account.last_equity ?? account.last_balance
              const bal = account.last_balance ?? account.last_equity
              if (eq != null && Number.isFinite(Number(eq))) equity[account.id] = Number(eq)
              if (bal != null && Number.isFinite(Number(bal))) balance[account.id] = Number(bal)
              return
            }
            try {
              const { summary, performance_baseline_balance } = await metatraderApi.summary(account.id, {
                calendarDay,
                timezoneOffsetMinutes,
              })
              const eq = summary.equity ?? summary.balance
              const bal = summary.balance ?? summary.equity
              if (eq != null && Number.isFinite(Number(eq))) equity[account.id] = Number(eq)
              if (bal != null && Number.isFinite(Number(bal))) balance[account.id] = Number(bal)
              const baseline = Number(performance_baseline_balance)
              if (Number.isFinite(baseline) && baseline > 0) {
                baselineById[account.id] = baseline
              }
            } catch {
              const eq = account.last_equity ?? account.last_balance
              const bal = account.last_balance ?? account.last_equity
              if (eq != null && Number.isFinite(Number(eq))) equity[account.id] = Number(eq)
              if (bal != null && Number.isFinite(Number(bal))) balance[account.id] = Number(bal)
            }
          }),
        )

        setAccounts(
          linked.map(a => {
            const baseline = baselineById[a.id]
            return baseline != null
              ? { ...a, performance_baseline_balance: baseline }
              : a
          }),
        )
        setEquityByAccountId(equity)
        setBalanceByAccountId(balance)
        setLastUpdated(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load performance data')
      } finally {
        inflightRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    },
    [userId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const hasMtHistory = mtTrades.length > 0

  const chartTrades = useMemo(() => {
    if (hasMtHistory) {
      return resolveDashboardChartTrades(mtTrades, [])
    }
    return []
  }, [hasMtHistory, mtTrades])

  const statsRows = useMemo(
    () => (hasMtHistory ? mtTradesToStatsRows(mtTrades) : chartTradesToStatsRows(chartTrades)),
    [hasMtHistory, mtTrades, chartTrades],
  )

  const tradesByAccountId = useMemo(() => {
    const out: Record<string, ReturnType<typeof mtTradesToStatsRows>> = {}
    for (const t of mtTrades) {
      const rows = mtTradesToStatsRows([t])
      if (!rows[0]) continue
      const list = out[t.broker_id] ?? []
      list.push(rows[0])
      out[t.broker_id] = list
    }
    return out
  }, [mtTrades])

  const perAccountPerformance = useMemo(
    () => computeLinkedAccountPerformanceMap(accounts, tradesByAccountId, equityByAccountId),
    [accounts, tradesByAccountId, equityByAccountId],
  )

  const aggregate = useMemo(
    () => aggregateAccountPerformance(perAccountPerformance),
    [perAccountPerformance],
  )

  const periodStats = useCallback(
    (period: PerformancePeriod) =>
      chartTrades.length > 0
        ? computePeriodStatsFromChartTrades(chartTrades, period)
        : computePeriodTradeStats(statsRows, period),
    [chartTrades, statsRows],
  )

  const hasMtBrokers = accounts.some(isMtLinkedBroker)

  return {
    accounts,
    chartTrades,
    hasMtHistory,
    hasMtBrokers,
    equityByAccountId,
    balanceByAccountId,
    perAccountPerformance,
    aggregate,
    periodStats,
    loading,
    refreshing,
    error,
    lastUpdated,
    refresh: () => void load(true),
  }
}
