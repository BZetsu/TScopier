import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { Trade } from '../../types/database'

type Filter = 'all' | 'open' | 'closed'

export function TradesPage() {
  const { user } = useAuth()
  const [trades, setTrades] = useState<Trade[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadTrades()
  }, [user, filter])

  const loadTrades = async () => {
    setLoading(true)
    let query = supabase
      .from('trades')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data } = await query
    setTrades(data ?? [])
    setLoading(false)
  }

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Trades</h1>
          <p className="text-sm text-neutral-500 mt-0.5">History of all copied trades</p>
        </div>
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
            </button>
          ))}
        </div>
      </div>

      <Card padding="none">
        {/* Table header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500 uppercase tracking-wide">
          <span>Symbol / Direction</span>
          <span>Entry</span>
          <span>SL / TP</span>
          <span>Lot</span>
          <span>P&L</span>
          <span>Status</span>
        </div>

        {loading ? (
          <div className="divide-y divide-neutral-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex gap-4">
                {[...Array(6)].map((_, j) => (
                  <div key={j} className="h-4 bg-neutral-100 rounded animate-pulse flex-1" />
                ))}
              </div>
            ))}
          </div>
        ) : trades.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 text-neutral-200" />
            <p className="text-sm text-neutral-400 font-medium">No trades yet</p>
            <p className="text-xs text-neutral-300 mt-1">Trades will appear here once signals are executed</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {trades.map(trade => <TradeRow key={trade.id} trade={trade} />)}
          </div>
        )}
      </Card>
    </div>
  )
}

function TradeRow({ trade }: { trade: Trade }) {
  const isBuy = trade.direction === 'buy'
  const profit = trade.profit

  const statusConfig: Record<string, { variant: 'success' | 'warning' | 'error' | 'neutral' | 'primary'; label: string }> = {
    open: { variant: 'primary', label: 'Open' },
    closed: { variant: 'neutral', label: 'Closed' },
    modified: { variant: 'warning', label: 'Modified' },
    cancelled: { variant: 'error', label: 'Cancelled' },
  }

  const status = statusConfig[trade.status] ?? { variant: 'neutral', label: trade.status }

  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-3.5 items-center hover:bg-neutral-50 transition-colors">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isBuy ? 'bg-success-50 text-success-600' : 'bg-error-50 text-error-600'
        }`}>
          {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        </div>
        <div>
          <p className="text-sm font-semibold text-neutral-900">{trade.symbol}</p>
          <p className={`text-xs font-medium uppercase ${isBuy ? 'text-success-600' : 'text-error-600'}`}>
            {trade.direction}
          </p>
        </div>
      </div>
      <span className="text-sm text-neutral-700 font-mono">
        {trade.entry_price?.toFixed(5) ?? '—'}
      </span>
      <div>
        <p className="text-xs text-neutral-500 font-mono">SL: {trade.sl?.toFixed(5) ?? '—'}</p>
        <p className="text-xs text-neutral-500 font-mono">TP: {trade.tp?.toFixed(5) ?? '—'}</p>
      </div>
      <span className="text-sm text-neutral-700">{trade.lot_size}</span>
      <span className={`text-sm font-medium font-mono ${
        profit === null ? 'text-neutral-400' :
        profit > 0 ? 'text-success-600' :
        profit < 0 ? 'text-error-600' : 'text-neutral-500'
      }`}>
        {profit === null ? '—' : (
          <span className="flex items-center gap-1">
            {profit > 0 ? <TrendingUp className="w-3 h-3" /> : profit < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {profit > 0 ? '+' : ''}{profit.toFixed(2)}
          </span>
        )}
      </span>
      <Badge variant={status.variant} size="sm">{status.label}</Badge>
    </div>
  )
}
