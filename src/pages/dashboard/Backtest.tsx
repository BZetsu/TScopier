import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crosshair, Loader2, Radio } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import { backtestApi } from '../../lib/backtestApi'
import type {
  BacktestRunRow,
  BacktestSummary,
  BacktestTradeRow,
  SimpleBacktestConfig,
} from '../../lib/backtestTypes'
import { BacktestSignalBreakdown } from '../../components/backtest/BacktestSignalBreakdown'
import {
  formatPipValue,
  sanitizeBacktestUserError,
  tradePipPnl,
} from '../../lib/backtestDisplay'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'

interface ChannelOption {
  id: string
  display_name: string
}

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  }
}

function buildConfig(
  channelId: string,
  dateFrom: string,
  dateTo: string,
): SimpleBacktestConfig {
  return {
    channelIds: [channelId],
    dateFrom,
    dateTo,
    initialBalance: 10_000,
    fixedLot: 0.1,
    timeframe: '5m',
  }
}

function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  const valueClass =
    tone === 'good' ? 'text-teal-600' : tone === 'bad' ? 'text-error-600' : 'text-neutral-900 dark:text-neutral-50'
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={clsx('text-xl font-semibold mt-1 tabular-nums', valueClass)}>{value}</p>
      {sub ? <p className="text-xs text-neutral-500 mt-0.5">{sub}</p> : null}
    </div>
  )
}

export function Backtest() {
  const t = useT()
  const { user } = useAuth()
  const defaultDates = useMemo(() => defaultDateRange(), [])
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom)
  const [dateTo, setDateTo] = useState(defaultDates.dateTo)
  const [activeRun, setActiveRun] = useState<BacktestRunRow | null>(null)
  const [trades, setTrades] = useState<BacktestTradeRow[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const summary = activeRun?.summary as BacktestSummary | null | undefined
  const isActive = running || activeRun?.status === 'running' || activeRun?.status === 'pending'

  const channelNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const ch of channels) m[ch.id] = ch.display_name
    return m
  }, [channels])

  const totalPips = useMemo(() => {
    if (summary?.totalPips != null && Number.isFinite(summary.totalPips)) {
      return summary.totalPips
    }
    let sum = 0
    let hasAny = false
    for (const tr of trades) {
      const p = tradePipPnl(tr)
      if (p == null) continue
      sum += p
      hasAny = true
    }
    return hasAny ? sum : null
  }, [summary?.totalPips, trades])

  const noDataCount = useMemo(
    () => trades.filter(tr => tr.outcome === 'no_data').length,
    [trades],
  )

  const loadRun = useCallback(async (runId: string) => {
    const { run, trades: t } = await backtestApi.getRun(runId)
    setActiveRun(run)
    setTrades(t)
    return run
  }, [])

  useEffect(() => {
    if (!user) return
    void (async () => {
      const { data } = await supabase
        .from('telegram_channels')
        .select('id, display_name')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('display_name')
      setChannels((data ?? []).map(r => ({
        id: r.id as string,
        display_name: (r.display_name as string) || 'Channel',
      })))
    })()
  }, [user])

  useEffect(() => {
    if (!activeRun?.id || !isActive) return
    const runId = activeRun.id
    const poll = setInterval(() => {
      void loadRun(runId).then(run => {
        if (run.status === 'completed' || run.status === 'failed') {
          setRunning(false)
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(poll)
  }, [activeRun?.id, isActive, loadRun])

  useEffect(() => {
    if (!activeRun?.id || !isActive) return
    const ch = supabase
      .channel(`backtest-run-${activeRun.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'backtest_runs',
          filter: `id=eq.${activeRun.id}`,
        },
        () => { void loadRun(activeRun.id) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [activeRun?.id, isActive, loadRun])

  const selectChannel = (id: string) => {
    setSelectedChannelId(prev => (prev === id ? null : id))
    setError('')
  }

  const startBacktest = async () => {
    if (!selectedChannelId) {
      setError('Select a signal channel')
      return
    }
    setError('')
    setRunning(true)
    setTrades([])
    setActiveRun(null)
    try {
      const config = buildConfig(selectedChannelId, dateFrom, dateTo)
      const { run_id } = await backtestApi.backtestTpsl(config)
      const run = await loadRun(run_id)
      if (run.status === 'completed' || run.status === 'failed') {
        setRunning(false)
      }
    } catch (e) {
      setError(sanitizeBacktestUserError(e instanceof Error ? e.message : String(e)))
      setRunning(false)
    }
  }

  const statusLine = activeRun?.progress_message ?? (running ? 'Starting backtest…' : null)
  const canRun = Boolean(selectedChannelId) && !isActive

  const totalPipsTone = totalPips == null ? 'neutral' : totalPips >= 0 ? 'good' : 'bad'

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          {t.backtest.title}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Select a signal channel and date range, then run a backtest. Signals are pulled from Telegram,
          checked against Massive market data, and scored by TP/SL outcome, pips, and duration.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {activeRun?.status === 'failed' && activeRun.error_message ? (
        <Alert variant="error">{sanitizeBacktestUserError(activeRun.error_message)}</Alert>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(280px,340px)_1fr] gap-6">
        <div className="space-y-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div>
            <p className="text-xs font-medium text-neutral-500 mb-2 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" />
              Signal channel
            </p>
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 ? (
                <p className="text-sm text-neutral-400">{t.backtest.noActiveChannels}</p>
              ) : (
                channels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => selectChannel(ch.id)}
                    disabled={isActive}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-50',
                      selectedChannelId === ch.id
                        ? 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300',
                    )}
                  >
                    {ch.display_name}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-neutral-500">{t.backtest.from}</span>
              <input
                type="date"
                disabled={isActive}
                className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm disabled:opacity-50"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500">{t.backtest.to}</span>
              <input
                type="date"
                disabled={isActive}
                className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm disabled:opacity-50"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </label>
          </div>

          <Button
            className="w-full"
            onClick={() => void startBacktest()}
            disabled={!canRun}
          >
            {isActive ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Running backtest…
              </>
            ) : (
              <>
                <Crosshair className="w-4 h-4 mr-2" />
                Backtest
              </>
            )}
          </Button>

          {statusLine ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{statusLine}</p>
          ) : null}
          {isActive && activeRun?.progress_pct != null ? (
            <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-teal-500 transition-all duration-500"
                style={{ width: `${Math.min(100, activeRun.progress_pct)}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {summary && activeRun?.status === 'completed' ? (
            <>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  Total pips ({dateFrom} → {dateTo})
                </p>
                <p
                  className={clsx(
                    'text-4xl font-bold tabular-nums mt-2',
                    totalPipsTone === 'good' && 'text-teal-600 dark:text-teal-400',
                    totalPipsTone === 'bad' && 'text-error-600 dark:text-error-400',
                    totalPipsTone === 'neutral' && 'text-neutral-900 dark:text-neutral-50',
                  )}
                >
                  {formatPipValue(totalPips)}
                </p>
                {selectedChannelId && channelNames[selectedChannelId] ? (
                  <p className="text-xs text-neutral-500 mt-2">{channelNames[selectedChannelId]}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Win rate"
                  value={`${(summary.winRate * 100).toFixed(1)}%`}
                />
                <StatCard
                  label="Wins / losses"
                  value={`${summary.wins} / ${summary.losses}`}
                />
                <StatCard
                  label="Signals"
                  value={String(summary.tradedSignals)}
                  sub={noDataCount > 0 ? `${noDataCount} no market data` : undefined}
                />
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200 px-4 pt-4 pb-2 sm:px-5">
                  {t.backtest.signalBreakdown}
                </p>
                <BacktestSignalBreakdown trades={trades} channelNames={channelNames} />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 p-12 text-center text-sm text-neutral-400">
              {isActive
                ? statusLine ?? 'Running backtest…'
                : 'Select a channel and date range, then run backtest.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
