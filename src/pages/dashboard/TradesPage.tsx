import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { metatraderApi, type MtTrade } from '../../lib/metatraderapi'

type Filter = 'all' | 'open' | 'closed'

const AUTO_REFRESH_MS = 15000

export function TradesPage() {
  const { user } = useAuth()
  const [trades, setTrades] = useState<MtTrade[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const inflightRef = useRef(false)

  const loadTrades = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (inflightRef.current) return
      inflightRef.current = true
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        if (!user?.id) {
          setTrades([])
          return
        }
        const res = await metatraderApi.trades({ scope: 'all' })
        setTrades(res.trades ?? [])
        setError(null)
        setLastSyncedAt(Date.now())
        if (res.debug?.raw_sample) {
          console.info('[Trades] raw sample order keys:', res.debug.raw_sample_keys)
          console.info('[Trades] raw sample order:', res.debug.raw_sample)
        }
      } catch (e) {
        if (!silent) {
          setTrades([])
        }
        setError(e instanceof Error ? e.message : 'Failed to load trades')
      } finally {
        inflightRef.current = false
        if (!silent) setLoading(false)
        else setRefreshing(false)
      }
    },
    [user?.id],
  )

  useEffect(() => {
    if (!user) return
    void loadTrades()
  }, [user, loadTrades])

  useEffect(() => {
    if (!user) return
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadTrades({ silent: true })
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [user, loadTrades])

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: trades.length },
    { value: 'open', label: 'Open', count: trades.filter(t => t.status === 'open').length },
    { value: 'closed', label: 'Closed', count: trades.filter(t => t.status === 'closed').length },
  ]

  const visibleTrades = filter === 'all' ? trades : trades.filter(t => t.status === filter)

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Trades</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Live positions and recent closes from your linked broker accounts
            {lastSyncedAt && (
              <span className="text-neutral-400"> · synced {formatRelative(lastSyncedAt)}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadTrades({ silent: true })}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex bg-white border border-neutral-200 rounded-lg p-0.5 gap-0.5">
            {filters.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  filter === f.value
                    ? 'bg-teal-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {f.label}
                <span className={`ml-1.5 text-xs ${filter === f.value ? 'text-teal-100' : 'text-neutral-400'}`}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && !loading && (
        <div className="mb-4 px-4 py-2.5 rounded-md bg-error-50 border border-error-100 text-sm text-error-700">
          {error}
        </div>
      )}

      <Card padding="none">
        {loading ? (
          <div className="divide-y divide-neutral-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex gap-4">
                {[...Array(9)].map((__, j) => (
                  <div key={j} className="h-4 bg-neutral-100 rounded animate-pulse flex-1" />
                ))}
              </div>
            ))}
          </div>
        ) : visibleTrades.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 text-neutral-200" />
            <p className="text-sm text-neutral-400 font-medium">No trades to show</p>
            <p className="text-xs text-neutral-300 mt-1">
              {filter === 'open'
                ? 'No open positions on any of your linked broker accounts.'
                : filter === 'closed'
                  ? 'No recent closed orders in this MT session.'
                  : 'Connect a broker account in Account & Configuration to see live trades here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-neutral-100 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-center">Symbol</th>
                  <th className="px-2 py-3 text-center">Direction</th>
                  <th className="px-2 py-3 text-center">Broker</th>
                  <th className="px-2 py-3 text-center">Entry</th>
                  <th className="px-2 py-3 text-center">SL</th>
                  <th className="px-2 py-3 text-center">TP</th>
                  <th className="px-2 py-3 text-center">Lots</th>
                  <th className="px-2 py-3 text-center">PnL</th>
                  <th className="px-2 py-3 text-center">Time</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibleTrades.map(trade => <TradeRow key={trade.id} trade={trade} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function TradeRow({ trade }: { trade: MtTrade }) {
  const isBuy = trade.direction === 'buy'
  const isSell = trade.direction === 'sell'
  const profit = trade.profit

  const statusConfig: Record<string, { variant: 'success' | 'warning' | 'error' | 'neutral' | 'primary'; label: string }> = {
    open: { variant: 'primary', label: 'Open' },
    closed: { variant: 'neutral', label: 'Closed' },
  }
  const status = statusConfig[trade.status] ?? { variant: 'neutral', label: trade.status }

  const timeIso = trade.status === 'closed' ? (trade.closed_at ?? trade.opened_at) : trade.opened_at
  const broker = trade.broker_name || trade.broker_label || '—'

  // Prefer the normalized type label (handles "Buy", "Sell", "Buy Limit", etc.).
  // Fall back to the bare direction so we never render an empty cell for tradeable rows.
  const directionLabel = trade.type
    ? trade.type
    : isBuy
      ? 'Buy'
      : isSell
        ? 'Sell'
        : '—'

  return (
    <tr className="hover:bg-neutral-50 transition-colors">
      <td className="px-4 py-3.5 text-sm font-semibold text-neutral-900 text-center">
        <div>{trade.symbol || '—'}</div>
        <div className="text-[10px] text-neutral-400 font-normal tabular-nums mt-0.5">#{trade.ticket}</div>
      </td>
      <td className={`px-2 py-3.5 text-sm font-medium text-center ${
        isBuy ? 'text-success-600' : isSell ? 'text-error-600' : 'text-neutral-500'
      }`}>
        <span className="inline-flex items-center justify-center gap-1 w-full">
          {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : isSell ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          {directionLabel}
        </span>
      </td>
      <td className="px-2 py-3.5 text-xs text-neutral-600 text-center truncate" title={broker}>{broker}</td>
      <td className="px-2 py-3.5 text-sm text-neutral-700 text-center tabular-nums">{formatPrice(trade.entry_price)}</td>
      <td className="px-2 py-3.5 text-sm text-neutral-700 text-center tabular-nums">{formatPrice(trade.sl)}</td>
      <td className="px-2 py-3.5 text-sm text-neutral-700 text-center tabular-nums">{formatPrice(trade.tp)}</td>
      <td className="px-2 py-3.5 text-sm text-neutral-700 text-center tabular-nums">{trade.lot_size ? trade.lot_size.toFixed(2) : '—'}</td>
      <td className={`px-2 py-3.5 text-sm font-medium text-center tabular-nums ${
        profit === null ? 'text-neutral-400' :
        profit > 0 ? 'text-success-600' :
        profit < 0 ? 'text-error-600' : 'text-neutral-500'
      }`}>
        {profit === null ? '—' : (
          <span className="inline-flex items-center justify-center gap-1 w-full">
            {profit > 0 ? <TrendingUp className="w-3 h-3" /> : profit < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {profit > 0 ? '+' : ''}{profit.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-2 py-3.5 text-xs text-neutral-500 whitespace-nowrap text-center">
        {timeIso
          ? new Date(timeIso).toLocaleString([], {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </td>
      <td className="px-4 py-3.5 text-center">
        <span className="inline-flex justify-center w-full">
          <Badge variant={status.variant} size="sm">{status.label}</Badge>
        </span>
      </td>
    </tr>
  )
}

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return '—'
  if (!Number.isFinite(value) || value === 0) return '—'
  return value.toFixed(5)
}

function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}
