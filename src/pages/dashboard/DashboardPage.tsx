import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ChevronRight, Info, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { BrokerAccount, Signal, Trade } from '../../types/database'
import { AddAccountModal } from '../../components/ui/AddAccountModal'

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
  const EDGE_ACCOUNT_SUMMARY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metatrader-account-summary`
  const EDGE_BROKER_TRADES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metatrader-trades`
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
  const [linkedAccountBalances, setLinkedAccountBalances] = useState<Record<string, { balance?: number; equity?: number; currency?: string; broker?: string; account_type?: 'Live' | 'Demo'; open_pnl?: number; open_trades?: number }>>({})
  const [showPlatformModal, setShowPlatformModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const AUTO_REFRESH_MS = 15000
  const DASHBOARD_CACHE_PREFIX = 'dashboard_cache_v1'

  useEffect(() => {
    if (!user) return
    const cacheKey = `${DASHBOARD_CACHE_PREFIX}:${user.id}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          stats?: DashboardStats
          copierLogs?: Signal[]
          linkedAccounts?: BrokerAccount[]
          linkedAccountBalances?: Record<string, { balance?: number; equity?: number; currency?: string; broker?: string; account_type?: 'Live' | 'Demo'; open_pnl?: number; open_trades?: number }>
        }
        if (parsed.stats) setStats(parsed.stats)
        if (parsed.copierLogs) setCopierLogs(parsed.copierLogs)
        if (parsed.linkedAccounts) setLinkedAccounts(parsed.linkedAccounts)
        if (parsed.linkedAccountBalances) setLinkedAccountBalances(parsed.linkedAccountBalances)
        setLoading(false)
        void loadDashboard({ silent: true })
        return
      } catch {
        // Ignore malformed cache and do a normal load below.
      }
    }
    void loadDashboard()
  }, [user])

  useEffect(() => {
    if (!user) return

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      // Reduce unnecessary API calls when tab is not visible.
      if (document.visibilityState !== 'visible') return
      await loadDashboard({ silent: true })
    }

    const interval = window.setInterval(() => {
      void tick()
    }, AUTO_REFRESH_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user])

  const loadDashboard = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true)
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
    const openPnlFromTrades = openTrades.reduce((sum, t) => sum + (t.profit ?? 0), 0)
    const won = closedTrades.filter(t => (t.profit ?? 0) > 0).length
    const lost = closedTrades.filter(t => (t.profit ?? 0) < 0).length
    const brokerAccounts = (brokerRes.data ?? []) as BrokerAccount[]
    const activeBrokerCount = brokerAccounts.filter(account => account.is_active).length
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const balanceEntries = await Promise.all(
      brokerAccounts.map(async (account) => {
        if (!token) return [account.id, {}] as const
        try {
          const res = await fetch(EDGE_ACCOUNT_SUMMARY, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ broker_account_id: account.id }),
          })
          const data = await res.json()
          if (!res.ok || !data?.summary) return [account.id, {}] as const
          const s = data.summary as Record<string, unknown>
          const balance = Number(s.balance ?? s.Balance)
          const equity = Number(s.equity ?? s.Equity)
          const currency = String(s.currency ?? s.Currency ?? '')
          const broker = String(s.broker ?? s.Broker ?? '')
          const accountTypeRaw = String(s.account_type ?? s.accountType ?? s.AccountType ?? '').toLowerCase()
          const open_pnl_num = Number(s.open_pnl ?? s.openProfit ?? s.OpenProfit ?? s.floatingProfit ?? s.FloatingProfit)
          const open_trades_num = Number(s.open_trades ?? s.openTrades ?? s.OpenTrades)
          const account_type = accountTypeRaw === 'demo' ? 'Demo' : accountTypeRaw === 'live' ? 'Live' : undefined
          return [account.id, {
            balance: Number.isFinite(balance) ? balance : undefined,
            equity: Number.isFinite(equity) ? equity : undefined,
            currency: currency || undefined,
            broker: broker || undefined,
            account_type,
            open_pnl: Number.isFinite(open_pnl_num) ? open_pnl_num : undefined,
            open_trades: Number.isFinite(open_trades_num) ? open_trades_num : undefined,
          }] as const
        } catch {
          return [account.id, {}] as const
        }
      })
    )
    const balanceMap = Object.fromEntries(balanceEntries) as Record<string, { balance?: number; equity?: number; currency?: string; broker?: string; account_type?: 'Live' | 'Demo'; open_pnl?: number; open_trades?: number }>
    const totalPortfolioValue = brokerAccounts.reduce((sum, account) => {
      const acct = balanceMap[account.id]
      return sum + (acct?.equity ?? acct?.balance ?? 0)
    }, 0)
    const totalLiveOpenPnl = brokerAccounts.reduce((sum, account) => {
      const acct = balanceMap[account.id]
      return sum + (acct?.open_pnl ?? 0)
    }, 0)
    const totalLiveOpenTradesFromSummary = brokerAccounts.reduce((sum, account) => {
      const acct = balanceMap[account.id]
      return sum + (acct?.open_trades ?? 0)
    }, 0)
    const hasAnyBrokerOpenPnl = brokerAccounts.some(account => balanceMap[account.id]?.open_pnl != null)
    const hasAnyBrokerOpenTradesFromSummary = brokerAccounts.some(account => balanceMap[account.id]?.open_trades != null)

    let liveOpenTradesCount: number | null = null
    if (token) {
      try {
        const openTradesRes = await fetch(EDGE_BROKER_TRADES, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filter: 'open' }),
        })
        const openTradesData = await openTradesRes.json()
        if (openTradesRes.ok && Array.isArray(openTradesData?.trades)) {
          liveOpenTradesCount = openTradesData.trades.length
        }
      } catch {
        // fallback below
      }
    }

    const resolvedOpenTradesCount =
      liveOpenTradesCount ??
      (hasAnyBrokerOpenTradesFromSummary ? totalLiveOpenTradesFromSummary : openTrades.length)
    setCopierLogs((logsRes.data ?? []) as Signal[])
    setLinkedAccounts(brokerAccounts)
    setLinkedAccountBalances(balanceMap)
    const nextStats: DashboardStats = {
      accounts: activeBrokerCount,
      portfolioValue: totalPortfolioValue,
      tradesTaken: closedTrades.length,
      tradesWon: won,
      tradesLost: lost,
      openPnl: hasAnyBrokerOpenPnl ? totalLiveOpenPnl : openPnlFromTrades,
      openPositions: resolvedOpenTradesCount,
      openTrades: resolvedOpenTradesCount,
      tradesCopiedToday: copiedToday,
      activeChannels: channelsRes.data?.length ?? 0,
      copierHealth: activeBrokerCount > 0 ? 'Stable' : 'Offline',
    }
    setStats(nextStats)
    if (user) {
      const cacheKey = `${DASHBOARD_CACHE_PREFIX}:${user.id}`
      sessionStorage.setItem(cacheKey, JSON.stringify({
        stats: nextStats,
        copierLogs: (logsRes.data ?? []) as Signal[],
        linkedAccounts: brokerAccounts,
        linkedAccountBalances: balanceMap,
      }))
    }
    if (!silent) setLoading(false)
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
            label="Total Balance"
            value={loading ? '—' : `$${stats.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
            valueColor={
              loading
                ? 'text-neutral-900'
                : stats.openPnl > 0
                  ? 'text-teal-600'
                  : stats.openPnl < 0
                    ? 'text-error-600'
                    : 'text-neutral-900'
            }
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
                label="Trading Accounts Connected"
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
            onClick={() => setShowPlatformModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-500 text-teal-600 rounded-lg text-xs font-medium hover:bg-teal-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        <div className="grid grid-cols-9 gap-2 px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-400">
          <span>Account</span>
          <span>Broker</span>
          <span>Account Type</span>
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
                {[...Array(9)].map((_, j) => (
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
              <LinkedAccountRow key={account.id} account={account} accountSummary={linkedAccountBalances[account.id]} />
            ))}
          </div>
        )}
      </div>

      <AddAccountModal
        open={showPlatformModal}
        onClose={() => setShowPlatformModal(false)}
        onSelect={() => {
          setShowPlatformModal(false)
          navigate('/account-config')
        }}
      />
    </div>
  )
}

function StatBlock({ label, value, sub, subColor, valueColor = 'text-neutral-900' }: {
  label: string
  value: string
  sub: string
  subColor: string
  valueColor?: string
}) {
  return (
    <div className="px-6 py-5">
      <p className="text-sm text-neutral-500 mb-2">{label}</p>
      <p className={`text-3xl font-semibold mb-1.5 ${valueColor}`}>{value}</p>
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

function LinkedAccountRow({
  account,
  accountSummary,
}: {
  account: BrokerAccount
  accountSummary?: { balance?: number; equity?: number; currency?: string; broker?: string; account_type?: 'Live' | 'Demo'; open_pnl?: number }
}) {
  const statusClass = account.is_active
    ? 'text-teal-600 border-teal-200 bg-teal-50'
    : 'text-warning-600 border-warning-200 bg-warning-50'
  const balanceText = accountSummary?.balance != null
    ? `${accountSummary.currency ?? '$'} ${accountSummary.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00'
  const pnl = accountSummary?.open_pnl ?? ((accountSummary?.equity ?? 0) - (accountSummary?.balance ?? 0))
  const pnlColor = pnl >= 0 ? 'text-teal-600' : 'text-error-600'
  const pnlText = `${accountSummary?.currency ?? '$'} ${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const brokerText = accountSummary?.broker || '—'
  const accountType = accountSummary?.account_type || '—'

  return (
    <div className="grid grid-cols-9 gap-2 px-5 py-3 items-center hover:bg-neutral-50 transition-colors">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-neutral-900">{account.label || 'Unnamed account'}</span>
        <span className="text-[11px] font-medium text-primary-600 uppercase">{account.platform}</span>
      </div>
      <span className="text-sm font-medium text-neutral-900">{brokerText}</span>
      <span className="text-sm font-medium text-neutral-900">{accountType}</span>
      <span className="text-sm font-medium text-neutral-900">{balanceText}</span>
      <span className={`text-sm font-semibold ${pnlColor}`}>{pnl >= 0 ? '+' : '-'}{pnlText}</span>
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
