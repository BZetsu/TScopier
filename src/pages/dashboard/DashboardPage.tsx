import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ChevronRight, Info, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { BrokerAccount, Signal, Trade } from '../../types/database'

interface DashboardStats {
  accounts: number
  portfolioValue: number
  tradesTaken: number
  tradesWon: number
  tradesLost: number
  openPnl: number
  openPositions: number
  openTrades: number
  tradesCopiedToday: number
  activeChannels: number
  copierHealth: 'Stable' | 'Degraded' | 'Offline'
}

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats>({
    accounts: 0,
    portfolioValue: 0,
    tradesTaken: 0,
    tradesWon: 0,
    tradesLost: 0,
    openPnl: 0,
    openPositions: 0,
    openTrades: 0,
    tradesCopiedToday: 0,
    activeChannels: 0,
    copierHealth: 'Stable',
  })
  const [copierLogs, setCopierLogs] = useState<Signal[]>([])
  const [linkedAccounts, setLinkedAccounts] = useState<BrokerAccount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadDashboard()
  }, [user])

  const loadDashboard = async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [brokerRes, channelsRes, tradesRes, todaySignalsRes, logsRes] = await Promise.all([
      supabase.from('broker_accounts').select('*').eq('user_id', user!.id),
      supabase.from('telegram_channels').select('id').eq('user_id', user!.id).eq('is_active', true),
      supabase.from('trades').select('*').eq('user_id', user!.id),
      supabase.from('signals').select('status').eq('user_id', user!.id).gte('created_at', today.toISOString()),
      supabase.from('signals').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(10),
    ])

    const allTrades = (tradesRes.data ?? []) as Trade[]
    const openTrades = allTrades.filter(t => t.status === 'open')
    const closedTrades = allTrades.filter(t => t.status === 'closed')
    const todaySignals = (todaySignalsRes.data ?? []) as { status: string }[]
    const copiedToday = todaySignals.filter(s => s.status === 'executed').length
    const openPnl = openTrades.reduce((sum, t) => sum + (t.profit ?? 0), 0)
    const won = closedTrades.filter(t => (t.profit ?? 0) > 0).length
    const lost = closedTrades.filter(t => (t.profit ?? 0) < 0).length
    const brokerAccounts = (brokerRes.data ?? []) as BrokerAccount[]
    const activeBrokerCount = brokerAccounts.filter(account => account.is_active).length
    setCopierLogs((logsRes.data ?? []) as Signal[])
    setLinkedAccounts(brokerAccounts)
    setStats({
      accounts: activeBrokerCount,
      portfolioValue: 0,
      tradesTaken: closedTrades.length,
      tradesWon: won,
      tradesLost: lost,
      openPnl,
      openPositions: openTrades.length,
      openTrades: openTrades.length,
      tradesCopiedToday: copiedToday,
      activeChannels: channelsRes.data?.length ?? 0,
      copierHealth: activeBrokerCount > 0 ? 'Stable' : 'Offline',
    })
    setLoading(false)
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
        
      </div>

      {/* Stats bar */}
      <div className="bg-white rounded-xl border border-neutral-100 shadow-card mb-6">
        <div className="grid grid-cols-4 divide-x divide-neutral-100">
          <StatBlock
            label="Accounts"
            value={loading ? '—' : String(stats.accounts)}
            sub={loading ? '' : `0% compared to 0, Yesterday`}
            subColor="text-neutral-400"
          />
          <StatBlock
            label="Portfolio Value"
            value={loading ? '—' : `$${stats.portfolioValue.toFixed(2)}`}
            sub={loading ? '' : `0% compared to $0.00, Yesterday`}
            subColor="text-neutral-400"
          />
          <StatBlock
            label="Trades Taken"
            value={loading ? '—' : String(stats.tradesTaken)}
            sub={loading ? '' : `Trades Won: ${stats.tradesWon} • Trades Lost: ${stats.tradesLost}`}
            subColor="text-neutral-400"
          />
          <StatBlock
            label="Open PnL"
            value={loading ? '—' : `$${stats.openPnl.toFixed(2)}`}
            sub={loading ? '' : `${stats.openPositions} open positions`}
            subColor={stats.openPnl >= 0 ? 'text-neutral-400' : 'text-error-500'}
          />
        </div>
      </div>

      {/* Lower panels */}
      <div className="grid grid-cols-2 gap-6">
        {/* Copier Overview */}
        <div className="bg-white rounded-xl border border-neutral-100 shadow-card">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-500" />
              <span className="text-sm font-semibold text-neutral-900">Copier Overview</span>
              <button className="text-neutral-300 hover:text-neutral-500">
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={() => navigate('/copier-engine')}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-500 text-teal-600 rounded-lg text-xs font-medium hover:bg-teal-50 transition-colors"
            >
              Manage
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Copier Status */}
            <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl">
              <span className="text-sm text-neutral-600 font-medium">Copier Status</span>
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${
                stats.copierHealth === 'Stable'
                  ? 'bg-teal-50 border-teal-200 text-teal-700'
                  : stats.copierHealth === 'Degraded'
                  ? 'bg-warning-50 border-warning-200 text-warning-700'
                  : 'bg-error-50 border-error-200 text-error-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  stats.copierHealth === 'Stable' ? 'bg-teal-500' :
                  stats.copierHealth === 'Degraded' ? 'bg-warning-500' : 'bg-error-500'
                }`} />
                {loading ? '—' : stats.copierHealth}
              </div>
            </div>

            {/* Grid stats */}
            <div className="grid grid-cols-2 gap-4">
              <OverviewStat
                label="Active Signal Channels"
                value={loading ? '—' : String(stats.activeChannels)}
              />
              <OverviewStat
                label="Masters Connected"
                value={loading ? '—' : String(stats.accounts)}
              />
              <OverviewStat
                label="Open Trades"
                value={loading ? '—' : String(stats.openTrades)}
              />
              <OverviewStat
                label="Trades Copied Today"
                value={loading ? '—' : String(stats.tradesCopiedToday)}
              />
            </div>
          </div>
        </div>

        {/* Copier Logs */}
        <div className="bg-white rounded-xl border border-neutral-100 shadow-card">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-500" />
              <span className="text-sm font-semibold text-neutral-900">Copier Logs</span>
              <button className="text-neutral-300 hover:text-neutral-500">
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={() => navigate('/copier-logs')}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-500 text-teal-600 rounded-lg text-xs font-medium hover:bg-teal-50 transition-colors"
            >
              Copier Logs
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-6 gap-2 px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-400 uppercase tracking-wide">
            <span>Status</span>
            <span>Channel</span>
            <span className="col-span-2">Symbol</span>
            <span>Type</span>
            <span className="text-right">P/L</span>
          </div>

          {loading ? (
            <div className="divide-y divide-neutral-50">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="px-5 py-3 flex gap-4">
                  {[...Array(6)].map((_, j) => (
                    <div key={j} className="h-4 bg-neutral-100 rounded animate-pulse flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : copierLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-5">
              <div className="w-20 h-20 bg-neutral-100 rounded-2xl flex items-center justify-center mb-3 relative">
                <svg className="w-10 h-10 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-neutral-200 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-1-1" />
                  </svg>
                </div>
              </div>
              <p className="text-sm text-neutral-400 font-medium">No Data</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-50 max-h-80 overflow-y-auto">
              {copierLogs.map(log => <LogRow key={log.id} signal={log} />)}
            </div>
          )}
        </div>
      </div>

      {/* Linked Accounts */}
      <div className="mt-6 bg-white rounded-xl border border-neutral-100 shadow-card">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-500" />
            <div>
              <p className="text-sm font-semibold text-neutral-900">Linked Accounts</p>
              <p className="text-xs text-neutral-400">Connected broker accounts used by copier</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/account-config')}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-500 text-teal-600 rounded-lg text-xs font-medium hover:bg-teal-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        <div className="grid grid-cols-8 gap-2 px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-400">
          <span>Account</span>
          <span>Broker</span>
          <span>Balance</span>
          <span>PnL</span>
          <span>ROI</span>
          <span>WinRate</span>
          <span>DD</span>
          <span className="text-right">Status</span>
        </div>

        {loading ? (
          <div className="divide-y divide-neutral-50">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="px-5 py-3 flex gap-4">
                {[...Array(8)].map((_, j) => (
                  <div key={j} className="h-4 bg-neutral-100 rounded animate-pulse flex-1" />
                ))}
              </div>
            ))}
          </div>
        ) : linkedAccounts.length === 0 ? (
          <div className="px-5 py-8 text-sm text-neutral-400">No linked accounts yet.</div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {linkedAccounts.map(account => (
              <LinkedAccountRow key={account.id} account={account} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatBlock({ label, value, sub, subColor }: {
  label: string
  value: string
  sub: string
  subColor: string
}) {
  return (
    <div className="px-6 py-5">
      <p className="text-sm text-neutral-500 mb-2">{label}</p>
      <p className="text-3xl font-semibold text-neutral-900 mb-1.5">{value}</p>
      <p className={`text-xs ${subColor}`}>{sub}</p>
    </div>
  )
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  )
}

function LogRow({ signal }: { signal: Signal }) {
  const parsed = signal.parsed_data as Record<string, unknown> | null
  const action = parsed?.action as string | undefined
  const symbol = parsed?.symbol != null ? String(parsed.symbol) : '—'

  const statusConfig: Record<string, { color: string; label: string }> = {
    executed: { color: 'text-teal-600 bg-teal-50', label: 'Executed' },
    skipped:  { color: 'text-warning-600 bg-warning-50', label: 'Skipped' },
    failed:   { color: 'text-error-600 bg-error-50', label: 'Failed' },
    pending:  { color: 'text-neutral-500 bg-neutral-100', label: 'Pending' },
    parsed:   { color: 'text-teal-600 bg-teal-50', label: 'Parsed' },
  }

  const s = statusConfig[signal.status] ?? { color: 'text-neutral-500 bg-neutral-100', label: signal.status }
  const isBuy = action === 'buy'

  return (
    <div className="grid grid-cols-6 gap-2 px-5 py-3 items-center hover:bg-neutral-50 transition-colors">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${s.color}`}>
        {s.label}
      </span>
      <span className="text-xs text-neutral-500 truncate">—</span>
      <span className="col-span-2 text-sm font-medium text-neutral-900">{symbol}</span>
      <span className={`text-xs font-medium uppercase ${isBuy ? 'text-primary-600' : action === 'sell' ? 'text-error-600' : 'text-neutral-500'}`}>
        {action ?? '—'}
      </span>
      <span className="text-xs text-neutral-400 text-right">—</span>
    </div>
  )
}

function LinkedAccountRow({ account }: { account: BrokerAccount }) {
  const statusClass = account.is_active
    ? 'text-teal-600 border-teal-200 bg-teal-50'
    : 'text-warning-600 border-warning-200 bg-warning-50'

  return (
    <div className="grid grid-cols-8 gap-2 px-5 py-3 items-center hover:bg-neutral-50 transition-colors">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-neutral-900">{account.metaapi_account_id || account.label}</span>
        <span className="text-[11px] font-medium text-primary-600 uppercase">{account.platform}</span>
      </div>
      <span className="text-sm font-medium text-neutral-900">{account.label || '—'}</span>
      <span className="text-sm font-medium text-neutral-900">$0.00</span>
      <span className="text-sm font-semibold text-teal-600">+0.00</span>
      <span className="text-sm font-semibold text-teal-600">0.0%</span>
      <span className="text-sm font-semibold text-neutral-900">0%</span>
      <span className="text-sm font-semibold text-neutral-900">0.0%</span>
      <div className="flex justify-end">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold ${statusClass}`}>
          {account.is_active ? 'Active' : 'Warning'}
        </span>
      </div>
    </div>
  )
}
