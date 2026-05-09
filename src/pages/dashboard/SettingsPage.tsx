import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { BrokerAccount, TelegramSession } from '../../types/database'
import { CircleCheck as CheckCircle, CircleAlert as AlertCircle } from 'lucide-react'

const PLATFORMS = [
  { value: 'MT4', label: 'MetaTrader 4 (MT4)' },
  { value: 'MT5', label: 'MetaTrader 5 (MT5)' },
  { value: 'cTrader', label: 'cTrader' },
  { value: 'DXTrade', label: 'DXTrade' },
  { value: 'TradeLocker', label: 'TradeLocker' },
]

export function SettingsPage() {
  const { user } = useAuth()
  const [broker, setBroker] = useState<BrokerAccount | null>(null)
  const [tgSession, setTgSession] = useState<TelegramSession | null>(null)
  const [form, setForm] = useState({
    label: '',
    platform: 'MT4',
    metaapi_account_id: '',
    default_lot_size: '0.01',
    pip_tolerance: '20',
    max_trades_per_zone: '1',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadSettings()
  }, [user])

  const loadSettings = async () => {
    const [brokerRes, sessionRes] = await Promise.all([
      supabase.from('broker_accounts').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('telegram_sessions').select('*').eq('user_id', user!.id).maybeSingle(),
    ])

    if (brokerRes.data) {
      setBroker(brokerRes.data)
      setForm({
        label: brokerRes.data.label,
        platform: brokerRes.data.platform,
        metaapi_account_id: brokerRes.data.metaapi_account_id,
        default_lot_size: brokerRes.data.default_lot_size.toString(),
        pip_tolerance: brokerRes.data.pip_tolerance.toString(),
        max_trades_per_zone: brokerRes.data.max_trades_per_zone.toString(),
      })
    }

    setTgSession(sessionRes.data)
    setLoading(false)
  }

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    const base = {
      label: form.label || `${form.platform} Account`,
      platform: form.platform,
      metaapi_account_id: form.metaapi_account_id.trim(),
      default_lot_size: parseFloat(form.default_lot_size) || 0.01,
      pip_tolerance: parseInt(form.pip_tolerance) || 20,
      max_trades_per_zone: parseInt(form.max_trades_per_zone) || 1,
      is_active: true,
    }

    const { error: dbErr } = broker
      ? await supabase.from('broker_accounts').update(base).eq('id', broker.id)
      : await supabase.from('broker_accounts').insert({
        user_id: user!.id,
        ...base,
        copier_mode: 'ai' as const,
        signal_channel_ids: [] as string[],
        ai_settings: {} as Record<string, never>,
      })

    setSaving(false)

    if (dbErr) {
      setError(dbErr.message)
      return
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    await loadSettings()
  }

  const disconnectTelegram = async () => {
    if (!tgSession) return
    await supabase.from('telegram_sessions').delete().eq('user_id', user!.id)
    setTgSession(null)
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="h-8 bg-neutral-100 rounded animate-pulse w-32 mb-6" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-neutral-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Settings</h1>
        <p className="text-sm text-neutral-500 mt-0.5">Manage your broker and Telegram connections</p>
      </div>

      {/* Telegram status */}
      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tgSession ? 'bg-success-50' : 'bg-neutral-100'}`}>
              {tgSession
                ? <CheckCircle className="w-5 h-5 text-success-600" />
                : <AlertCircle className="w-5 h-5 text-neutral-400" />
              }
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-900">Telegram</p>
              {tgSession ? (
                <p className="text-xs text-neutral-500">{tgSession.phone_number}</p>
              ) : (
                <p className="text-xs text-neutral-400">Not connected</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={tgSession ? 'success' : 'neutral'} size="sm">
              {tgSession ? 'Active' : 'Disconnected'}
            </Badge>
            {tgSession && (
              <Button variant="ghost" size="sm" onClick={disconnectTelegram} className="text-error-600 hover:bg-error-50 hover:text-error-700">
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Broker settings */}
      <Card>
        <h2 className="text-sm font-semibold text-neutral-900 mb-4">
          {broker ? 'Broker account' : 'Connect broker'}
        </h2>

        {error && (
          <div className="mb-4 px-3 py-2.5 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">
            {error}
          </div>
        )}

        {saved && (
          <div className="mb-4 px-3 py-2.5 bg-success-50 border border-success-200 rounded-lg text-sm text-success-700 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Settings saved
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <Select
            label="Trading platform"
            options={PLATFORMS}
            value={form.platform}
            onChange={e => set('platform', e.target.value)}
          />
          <Input
            label="MetaAPI Account ID"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={form.metaapi_account_id}
            onChange={e => set('metaapi_account_id', e.target.value)}
            required
          />
          <Input
            label="Account label"
            placeholder="e.g. My Live MT4 Account"
            value={form.label}
            onChange={e => set('label', e.target.value)}
          />
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Default lot size"
              type="number"
              min="0.01"
              step="0.01"
              value={form.default_lot_size}
              onChange={e => set('default_lot_size', e.target.value)}
            />
            <Input
              label="Pip tolerance"
              type="number"
              min="1"
              value={form.pip_tolerance}
              onChange={e => set('pip_tolerance', e.target.value)}
              hint="Max pips before skip"
            />
            <Input
              label="Max trades/zone"
              type="number"
              min="1"
              max="10"
              value={form.max_trades_per_zone}
              onChange={e => set('max_trades_per_zone', e.target.value)}
            />
          </div>
          <Button type="submit" loading={saving}>
            {broker ? 'Save settings' : 'Connect broker'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
