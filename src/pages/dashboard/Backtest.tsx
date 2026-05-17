import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, Loader2, Radio } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import { backtestApi } from '../../lib/backtestApi'
import type {
  BacktestEquityRow,
  BacktestRunRow,
  BacktestSummary,
  BacktestTradeRow,
  SimpleBacktestConfig,
} from '../../lib/backtestTypes'
import { BacktestEquityChart } from '../../components/backtest/BacktestEquityChart'
import { BacktestSignalBreakdown } from '../../components/backtest/BacktestSignalBreakdown'
import { sanitizeBacktestUserError } from '../../lib/backtestDisplay'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'

const LAST_RUN_KEY = 'backtest_last_run_id'

interface ChannelOption {
  id: string
  display_name: string
}

function defaultConfig(): SimpleBacktestConfig {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return {
    channelIds: [],
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    initialBalance: 10_000,
    fixedLot: 0.1,
    timeframe: '1m',
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
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [config, setConfig] = useState<SimpleBacktestConfig>(defaultConfig)
  const [activeRun, setActiveRun] = useState<BacktestRunRow | null>(null)
  const [trades, setTrades] = useState<BacktestTradeRow[]>([])
  const [equity, setEquity] = useState<BacktestEquityRow[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const summary = activeRun?.summary as BacktestSummary | null | undefined
  const isActive = running || activeRun?.status === 'running' || activeRun?.status === 'pending'

  const channelNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const ch of channels) m[ch.id] = ch.display_name
    return m
  }, [channels])

  const noDataCount = useMemo(
    () => trades.filter(tr => tr.outcome === 'no_data').length,
    [trades],
  )

  const loadRun = useCallback(async (runId: string) => {
    const { run, trades: t, equity: e } = await backtestApi.getRun(runId)
    setActiveRun(run)
    setTrades(t)
    setEquity(e)
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
      const lastId = localStorage.getItem(LAST_RUN_KEY)
      if (lastId) {
        try {
          await loadRun(lastId)
        } catch {
          localStorage.removeItem(LAST_RUN_KEY)
        }
      }
    })()
  }, [user, loadRun])

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

  const toggleChannel = (id: string) => {
    setConfig(prev => ({
      ...prev,
      channelIds: prev.channelIds.includes(id)
        ? prev.channelIds.filter(c => c !== id)
        : [...prev.channelIds, id],
    }))
  }

  const handleRun = async () => {
    if (config.channelIds.length === 0) {
      setError('Select at least one channel')
      return
    }
    setError('')
    setRunning(true)
    setTrades([])
    setEquity([])
    try {
      const { run_id } = await backtestApi.run(config)
      localStorage.setItem(LAST_RUN_KEY, run_id)
      const run = await loadRun(run_id)
      if (run.status === 'completed' || run.status === 'failed') {
        setRunning(false)
      }
    } catch (e) {
      setError(sanitizeBacktestUserError(e instanceof Error ? e.message : String(e)))
      setRunning(false)
    }
  }

  const statusLine = activeRun?.progress_message
    ?? (running ? 'Starting backtest…' : null)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          {t.backtest.title}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Sync Telegram signals, replay against Massive OHLC bars, simulate TP/SL outcomes.
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
              Channels
            </p>
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 ? (
                <p className="text-sm text-neutral-400">No active Telegram channels</p>
              ) : (
                channels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggleChannel(ch.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                      config.channelIds.includes(ch.id)
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
              <span className="text-xs text-neutral-500">From</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
                value={config.dateFrom}
                onChange={e => setConfig(c => ({ ...c, dateFrom: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500">To</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
                value={config.dateTo}
                onChange={e => setConfig(c => ({ ...c, dateTo: e.target.value }))}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-neutral-500">Starting balance (USD)</span>
            <input
              type="number"
              min={100}
              step={100}
              className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
              value={config.initialBalance}
              onChange={e => setConfig(c => ({ ...c, initialBalance: Number(e.target.value) }))}
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-500">Lot size</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
              value={config.fixedLot}
              onChange={e => setConfig(c => ({ ...c, fixedLot: Number(e.target.value) }))}
            />
          </label>

          <Button
            className="w-full"
            onClick={() => void handleRun()}
            disabled={isActive || config.channelIds.length === 0}
          >
            {isActive ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Running…
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                {t.backtest.runBacktest}
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Net PnL"
                  value={`$${summary.netPnl.toFixed(2)}`}
                  tone={summary.netPnl >= 0 ? 'good' : 'bad'}
                />
                <StatCard
                  label="Win rate"
                  value={`${(summary.winRate * 100).toFixed(1)}%`}
                />
                <StatCard
                  label="Max drawdown"
                  value={`${summary.maxDrawdownPct.toFixed(1)}%`}
                  tone="bad"
                />
                <StatCard
                  label="Signals"
                  value={String(summary.totalSignals)}
                  sub={noDataCount > 0 ? `${noDataCount} no market data` : undefined}
                />
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-3">Equity curve</p>
                <BacktestEquityChart equity={equity} />
              </div>

              <BacktestSignalBreakdown trades={trades} channelNames={channelNames} />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 p-12 text-center text-sm text-neutral-400">
              {isActive
                ? 'Backtest in progress…'
                : 'Configure channels and dates, then run a backtest to see results.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
