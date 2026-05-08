import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { BrokerAccount, TelegramSession } from '../../types/database'
import { CircleCheck as CheckCircle, CircleAlert as AlertCircle, Plus, Trash2, Server } from 'lucide-react'
import { AddAccountModal } from '../../components/ui/AddAccountModal'

const PLATFORMS = [
  { value: 'MT5', label: 'MetaTrader 5 (MT5)' },
  { value: 'MT4', label: 'MetaTrader 4 (MT4)' },
  { value: 'cTrader', label: 'cTrader' },
  { value: 'DXTrade', label: 'DXTrade' },
  { value: 'TradeLocker', label: 'TradeLocker' },
]

interface BrokerForm {
  label: string
  platform: string
  account_number: string
  account_password: string
  broker_server: string
  default_lot_size: string
  pip_tolerance: string
}

const emptyForm: BrokerForm = {
  label: '',
  platform: 'MT5',
  account_number: '',
  account_password: '',
  broker_server: '',
  default_lot_size: '0.01',
  pip_tolerance: '20',
}

interface BrokerSummaryResult {
  summary: { balance?: number; equity?: number; currency?: string }
  error?: string
}

export function AccountConfigPage() {
  const { user } = useAuth()
  const [brokers, setBrokers] = useState<BrokerAccount[]>([])
  const [brokerSummaries, setBrokerSummaries] = useState<Record<string, { balance?: number; equity?: number; currency?: string }>>({})
  const [brokerSummaryErrors, setBrokerSummaryErrors] = useState<Record<string, string>>({})
  const [tgSession, setTgSession] = useState<TelegramSession | null>(null)
  const [showPlatformModal, setShowPlatformModal] = useState(false)
  const [showAddBroker, setShowAddBroker] = useState(false)
  const [form, setForm] = useState<BrokerForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [connectingBroker, setConnectingBroker] = useState(false)
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const EDGE_CONNECT_BROKER = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connect-metatrader-account`
  const EDGE_SERVER_SUGGESTIONS = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mt-server-suggestions`
  const EDGE_ACCOUNT_SUMMARY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metatrader-account-summary`

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  useEffect(() => {
    if (!showAddBroker) return
    if (form.platform !== 'MT4' && form.platform !== 'MT5') return
    const q = form.broker_server.trim()
    const timeout = window.setTimeout(() => {
      void loadServerSuggestions(q, form.platform)
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [showAddBroker, form.platform, form.broker_server])

  const loadData = async () => {
    const [brokersRes, sessionRes] = await Promise.all([
      supabase.from('broker_accounts').select('*').eq('user_id', user!.id).order('created_at'),
      supabase.from('telegram_sessions').select('*').eq('user_id', user!.id).maybeSingle(),
    ])
    const nextBrokers = (brokersRes.data ?? []) as BrokerAccount[]
    setBrokers(nextBrokers)
    setTgSession(sessionRes.data as TelegramSession | null)
    void loadBrokerSummaries(nextBrokers)
    setLoading(false)
  }

  const set = (field: keyof BrokerForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const loadBrokerSummaries = async (rows: BrokerAccount[]) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    const pairs = await Promise.all(rows.map(async (broker): Promise<readonly [string, BrokerSummaryResult]> => {
      try {
        const res = await fetch(EDGE_ACCOUNT_SUMMARY, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ broker_account_id: broker.id }),
        })
        const data = await res.json()
        if (!res.ok || !data?.summary) {
          return [broker.id, { summary: {}, error: data?.error || 'Unavailable' }] as const
        }
        const summary = data.summary as Record<string, unknown>
        const balance = Number(summary.balance ?? summary.Balance)
        const equity = Number(summary.equity ?? summary.Equity)
        const currency = String(summary.currency ?? summary.Currency ?? '')
        return [broker.id, { summary: {
          balance: Number.isFinite(balance) ? balance : undefined,
          equity: Number.isFinite(equity) ? equity : undefined,
          currency: currency || undefined,
        } }] as const
      } catch {
        return [broker.id, { summary: {}, error: 'Unavailable' }] as const
      }
    }))
    const summaryMap: Record<string, { balance?: number; equity?: number; currency?: string }> = {}
    const errorMap: Record<string, string> = {}
    for (const [id, payload] of pairs) {
      summaryMap[id] = payload.summary
      if (payload.error) errorMap[id] = payload.error
    }
    setBrokerSummaries(summaryMap)
    setBrokerSummaryErrors(errorMap)
  }

  const loadServerSuggestions = async (q: string, platform: string) => {
    if (platform !== 'MT4' && platform !== 'MT5') {
      setServerSuggestions([])
      return
    }
    setLoadingSuggestions(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        setLoadingSuggestions(false)
        return
      }
      const res = await fetch(`${EDGE_SERVER_SUGGESTIONS}?platform=${encodeURIComponent(platform)}&q=${encodeURIComponent(q)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setServerSuggestions([])
      } else {
        setServerSuggestions((data.suggestions ?? []) as string[])
      }
    } catch {
      setServerSuggestions([])
    } finally {
      setLoadingSuggestions(false)
    }
  }

  const addBroker = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.account_number.trim() || !form.account_password.trim() || !form.broker_server.trim()) {
      setError('Account number, password, and server are required')
      return
    }

    if (form.platform === 'MT4' || form.platform === 'MT5') {
      setConnectingBroker(true)
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        if (!token) {
          setError('You are not authenticated')
          setConnectingBroker(false)
          return
        }

        const connectRes = await fetch(EDGE_CONNECT_BROKER, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            label: form.label,
            platform: form.platform,
            account_number: form.account_number.trim(),
            account_password: form.account_password,
            server: form.broker_server.trim(),
            default_lot_size: parseFloat(form.default_lot_size) || 0.01,
            pip_tolerance: parseInt(form.pip_tolerance) || 20,
          }),
        })
        const connectData = await connectRes.json()
        if (!connectRes.ok || !connectData.ok) {
          setError(connectData.error || 'Broker account connection failed')
          setConnectingBroker(false)
          return
        }

        setBrokers(prev => [...prev, connectData.broker_account as BrokerAccount])
        void loadBrokerSummaries([...brokers, connectData.broker_account as BrokerAccount])
        setForm(emptyForm)
        setShowAddBroker(false)
      } catch {
        setError('Failed to connect account with Metatraderapi.dev')
        setConnectingBroker(false)
        return
      } finally {
        setConnectingBroker(false)
      }
      return
    }
    setSaving(true)

    const { data, error: dbErr } = await supabase
      .from('broker_accounts')
      .insert({
        user_id: user!.id,
        label: form.label || `${form.platform} – ${form.account_number}`,
        platform: form.platform,
        metaapi_account_id: `${form.broker_server.trim()}|${form.account_number.trim()}`,
        default_lot_size: parseFloat(form.default_lot_size) || 0.01,
        pip_tolerance: parseInt(form.pip_tolerance) || 20,
        is_active: true,
        max_trades_per_zone: 1,
      })
      .select('*')
      .single()

    setSaving(false)
    if (dbErr) { setError(dbErr.message); return }

    setBrokers(prev => [...prev, data as BrokerAccount])
    setForm(emptyForm)
    setShowAddBroker(false)
  }

  const deleteBroker = async (id: string) => {
    setBrokers(prev => prev.filter(b => b.id !== id))
    await supabase.from('broker_accounts').delete().eq('id', id)
  }

  const toggleBroker = async (id: string, is_active: boolean) => {
    setBrokers(prev => prev.map(b => b.id === id ? { ...b, is_active } : b))
    await supabase.from('broker_accounts').update({ is_active }).eq('id', id)
  }

  const disconnectTelegram = async () => {
    await supabase.from('telegram_sessions').delete().eq('user_id', user!.id)
    setTgSession(null)
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white rounded-xl border border-neutral-100 animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Connections</h1>
        <p className="text-sm text-neutral-500 mt-0.5">Connect your trading accounts and Telegram to start copying signals</p>
      </div>

      {/* ── Broker Accounts ── */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Trading Accounts</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Connect your broker accounts.</p>
          </div>
          <Button size="sm" onClick={() => setShowPlatformModal(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add account
          </Button>
        </div>

        {showAddBroker && (
          <Card className="mb-3">
            <h3 className="text-sm font-semibold text-neutral-900 mb-4">New broker account</h3>
            {error && (
              <div className="mb-3 px-3 py-2 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">{error}</div>
            )}
            <form onSubmit={addBroker} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Platform" options={PLATFORMS} value={form.platform} onChange={e => set('platform', e.target.value)} />
                <Input label="Account label (optional)" placeholder="e.g. Live MT5" value={form.label} onChange={e => set('label', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Account number"
                  placeholder="Trading account number"
                  value={form.account_number}
                  onChange={e => set('account_number', e.target.value)}
                  required
                />
                <Input
                  label="Account password"
                  type="password"
                  placeholder="Trading account password"
                  value={form.account_password}
                  onChange={e => set('account_password', e.target.value)}
                  required
                />
              </div>
              <div className="relative">
                <Input
                  label="Broker server"
                  placeholder={loadingSuggestions ? 'Searching server suggestions...' : 'e.g. ICMarketsSC-MT5-2'}
                  value={form.broker_server}
                  onChange={e => {
                    set('broker_server', e.target.value)
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                  hint="Type to see suggestions. Unknown server is still allowed."
                  required
                />
                {showSuggestions && serverSuggestions.length > 0 && (
                  <div className="absolute z-20 top-[72px] left-0 right-0 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {serverSuggestions.map(server => (
                      <button
                        key={server}
                        type="button"
                        onMouseDown={() => {
                          set('broker_server', server)
                          setShowSuggestions(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                      >
                        {server}
                      </button>
                    ))}
                  </div>
                )}
                {showSuggestions && !loadingSuggestions && form.broker_server.trim() && serverSuggestions.length === 0 && (
                  <div className="absolute z-20 top-[72px] left-0 right-0 bg-white border border-neutral-200 rounded-lg shadow-lg px-3 py-2 text-xs text-neutral-500">
                    No suggestion match. You can still use this server.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Default lot size" type="number" min="0.01" step="0.01" value={form.default_lot_size} onChange={e => set('default_lot_size', e.target.value)} />
                <Input label="Pip tolerance" type="number" min="1" value={form.pip_tolerance} onChange={e => set('pip_tolerance', e.target.value)} hint="Max pips from signal before skip" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={saving || connectingBroker} size="sm">Connect account</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowAddBroker(false); setForm(emptyForm); setError('') }}>Cancel</Button>
              </div>
            </form>
          </Card>
        )}

        {brokers.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-neutral-200 py-10 text-center">
            <Server className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
            <p className="text-sm text-neutral-400">No accounts connected yet</p>
            <p className="text-xs text-neutral-300 mt-0.5">Add your trading account to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {brokers.map(broker => (
              <Card key={broker.id} padding="sm">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Server className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-neutral-900">{broker.label}</p>
                      <Badge variant={broker.is_active ? 'success' : 'neutral'} size="sm">
                        {broker.is_active ? 'Active' : 'Paused'}
                      </Badge>
                      <Badge variant="neutral" size="sm">{broker.platform}</Badge>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Lot: {broker.default_lot_size} · Pip tolerance: {broker.pip_tolerance}
                    </p>
                    {(brokerSummaries[broker.id]?.balance != null || brokerSummaries[broker.id]?.equity != null) && (
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {brokerSummaries[broker.id]?.balance != null && (
                          <span>
                            Balance: {brokerSummaries[broker.id]?.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {brokerSummaries[broker.id]?.currency ?? ''}
                          </span>
                        )}
                        {brokerSummaries[broker.id]?.balance != null && brokerSummaries[broker.id]?.equity != null && ' · '}
                        {brokerSummaries[broker.id]?.equity != null && (
                          <span>
                            Equity: {brokerSummaries[broker.id]?.equity?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {brokerSummaries[broker.id]?.currency ?? ''}
                          </span>
                        )}
                      </p>
                    )}
                    {!(brokerSummaries[broker.id]?.balance != null || brokerSummaries[broker.id]?.equity != null) && brokerSummaryErrors[broker.id] && (
                      <p className="text-xs text-warning-600 mt-0.5">
                        Balance unavailable
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleBroker(broker.id, !broker.is_active)}
                      className="px-3 py-1.5 text-xs font-medium border border-neutral-200 rounded-lg text-neutral-600 hover:bg-neutral-50 transition-colors"
                    >
                      {broker.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => deleteBroker(broker.id)}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-error-600 hover:bg-error-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <AddAccountModal
        open={showPlatformModal}
        onClose={() => setShowPlatformModal(false)}
        onSelect={(platform) => {
          setForm(prev => ({ ...prev, platform }))
          setShowPlatformModal(false)
          setShowAddBroker(true)
        }}
      />

      {/* ── Telegram ── */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Telegram Connection</h2>
          <p className="text-xs text-neutral-400 mt-0.5">Link your Telegram account to monitor signal channels in real time.</p>
        </div>

        <Card>
          {tgSession ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900">Telegram linked</p>
                  <p className="text-xs text-neutral-400">{tgSession.phone_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success" size="sm">Active</Badge>
                <Button variant="ghost" size="sm" onClick={disconnectTelegram} className="text-error-600 hover:bg-error-50 hover:text-error-700">
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900">Telegram not connected</p>
                  <p className="text-xs text-neutral-400">Required to read signal channels</p>
                </div>
              </div>
              <a
                href="/copier-engine"
                className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
              >
                Connect in Channels
              </a>
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
