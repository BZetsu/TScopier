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
  broker_server: string
  account_login: string
  account_password: string
  default_lot_size: string
  pip_tolerance: string
}

const emptyForm: BrokerForm = {
  label: '',
  platform: 'MT5',
  broker_server: '',
  account_login: '',
  account_password: '',
  default_lot_size: '0.01',
  pip_tolerance: '20',
}

const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`

export function AccountConfigPage() {
  const { user, session } = useAuth()
  const [brokers, setBrokers] = useState<BrokerAccount[]>([])
  const [tgSession, setTgSession] = useState<TelegramSession | null>(null)
  const [showPlatformModal, setShowPlatformModal] = useState(false)
  const [showAddBroker, setShowAddBroker] = useState(false)
  const [form, setForm] = useState<BrokerForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Telegram link state
  const [tgStage, setTgStage] = useState<'idle' | 'phone' | 'code' | 'linked'>('idle')
  const [tgPhone, setTgPhone] = useState('')
  const [tgCode, setTgCode] = useState('')
  const [tgPassword, setTgPassword] = useState('')
  const [tgPhoneCodeHash, setTgPhoneCodeHash] = useState('')
  const [tgSessionString, setTgSessionString] = useState('')
  const [tgLoading, setTgLoading] = useState(false)
  const [tgError, setTgError] = useState('')
  const [requiresPassword, setRequiresPassword] = useState(false)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  const loadData = async () => {
    const [brokersRes, sessionRes] = await Promise.all([
      supabase.from('broker_accounts').select('*').eq('user_id', user!.id).order('created_at'),
      supabase.from('telegram_sessions').select('*').eq('user_id', user!.id).maybeSingle(),
    ])
    setBrokers((brokersRes.data ?? []) as BrokerAccount[])
    setTgSession(sessionRes.data as TelegramSession | null)
    setLoading(false)
  }

  const set = (field: keyof BrokerForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const addBroker = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.account_login || !form.broker_server) {
      setError('Account login and broker server are required')
      return
    }
    setSaving(true)

    // metaapi_account_id stores "server|login" for our backend to provision via our MetaAPI token
    const metaapi_account_id = `${form.broker_server}|${form.account_login}`

    const { data, error: dbErr } = await supabase
      .from('broker_accounts')
      .insert({
        user_id: user!.id,
        label: form.label || `${form.platform} – ${form.account_login}`,
        platform: form.platform,
        metaapi_account_id,
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

  // Telegram flow
  const authHeaders = {
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setTgError('')
    setTgLoading(true)
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: 'send_code', phone: tgPhone }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setTgError(data.error || 'Failed to send code'); return }
      setTgPhoneCodeHash(data.phone_code_hash)
      setTgSessionString(data.session_string ?? '')
      setTgStage('code')
    } catch { setTgError('Network error') }
    finally { setTgLoading(false) }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setTgError('')
    setTgLoading(true)
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'verify_code',
          phone: tgPhone,
          code: tgCode,
          phone_code_hash: tgPhoneCodeHash,
          session_string: tgSessionString,
          password: requiresPassword ? tgPassword : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        if (data.requires_password) { setRequiresPassword(true); setTgError('Enter your Telegram 2FA password.'); return }
        setTgError(data.error || 'Verification failed')
        return
      }
      await supabase.from('telegram_sessions').upsert({
        user_id: user!.id,
        session_string: data.session_string,
        phone_number: tgPhone,
        is_active: true,
      }, { onConflict: 'user_id' })
      await loadData()
      setTgStage('linked')
    } catch { setTgError('Network error') }
    finally { setTgLoading(false) }
  }

  const disconnectTelegram = async () => {
    await supabase.from('telegram_sessions').delete().eq('user_id', user!.id)
    setTgSession(null)
    setTgStage('idle')
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
            <p className="text-xs text-neutral-400 mt-0.5">Connect your MT5/MT4 broker accounts. We manage the MetaAPI connection on your behalf.</p>
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
                <Input label="Broker server" placeholder="e.g. ICMarkets-Live" value={form.broker_server} onChange={e => set('broker_server', e.target.value)} required />
                <Input label="Account login" placeholder="Account number" value={form.account_login} onChange={e => set('account_login', e.target.value)} required />
              </div>
              <Input label="Account password" type="password" placeholder="MT5 account password" value={form.account_password} onChange={e => set('account_password', e.target.value)} required />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Default lot size" type="number" min="0.01" step="0.01" value={form.default_lot_size} onChange={e => set('default_lot_size', e.target.value)} />
                <Input label="Pip tolerance" type="number" min="1" value={form.pip_tolerance} onChange={e => set('pip_tolerance', e.target.value)} hint="Max pips from signal before skip" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={saving} size="sm">Connect account</Button>
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
          ) : tgStage === 'idle' ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900">Telegram not connected</p>
                  <p className="text-xs text-neutral-400">Required to read signal channels</p>
                </div>
              </div>
              <Button size="sm" onClick={() => setTgStage('phone')}>Connect Telegram</Button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-semibold">TG</div>
                <p className="text-sm font-semibold text-neutral-900">
                  {tgStage === 'phone' ? 'Enter your phone number' : 'Enter verification code'}
                </p>
              </div>

              {tgError && (
                <div className="mb-3 px-3 py-2 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">{tgError}</div>
              )}

              {tgStage === 'phone' ? (
                <form onSubmit={sendCode} className="space-y-3">
                  <Input
                    label="Phone number"
                    type="tel"
                    placeholder="+1 234 567 8900"
                    value={tgPhone}
                    onChange={e => setTgPhone(e.target.value)}
                    hint="Include country code"
                    required
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" loading={tgLoading} size="sm">Send code</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setTgStage('idle')}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={verifyCode} className="space-y-3">
                  <Input
                    label="Verification code"
                    placeholder="12345"
                    value={tgCode}
                    onChange={e => setTgCode(e.target.value)}
                    hint={`Sent to ${tgPhone}`}
                    required
                    autoFocus
                  />
                  {requiresPassword && (
                    <Input
                      label="2FA password"
                      type="password"
                      placeholder="Your Telegram password"
                      value={tgPassword}
                      onChange={e => setTgPassword(e.target.value)}
                      required
                    />
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" loading={tgLoading} size="sm">Verify</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setTgStage('phone'); setTgError('') }}>Back</Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
