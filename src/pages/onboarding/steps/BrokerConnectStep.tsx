import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { Card } from '../../../components/ui/Card'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Button } from '../../../components/ui/Button'

const PLATFORMS = [
  { value: 'MT4', label: 'MetaTrader 4 (MT4)' },
  { value: 'MT5', label: 'MetaTrader 5 (MT5)' },
  { value: 'cTrader', label: 'cTrader' },
  { value: 'DXTrade', label: 'DXTrade' },
  { value: 'TradeLocker', label: 'TradeLocker' },
]

interface Props {
  onDone: (accountId: string) => void
}

export function BrokerConnectStep({ onDone }: Props) {
  const { user } = useAuth()
  const [form, setForm] = useState({
    label: '',
    platform: 'MT4',
    metaapi_account_id: '',
    default_lot_size: '0.01',
    pip_tolerance: '20',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.metaapi_account_id.trim()) {
      setError('MetaAPI Account ID is required')
      return
    }

    setLoading(true)

    const { data, error: dbErr } = await supabase
      .from('broker_accounts')
      .insert({
        user_id: user!.id,
        label: form.label || `${form.platform} Account`,
        platform: form.platform,
        metaapi_account_id: form.metaapi_account_id.trim(),
        default_lot_size: parseFloat(form.default_lot_size) || 0.01,
        pip_tolerance: parseInt(form.pip_tolerance) || 20,
        is_active: true,
        max_trades_per_zone: 1,
      })
      .select('id')
      .single()

    setLoading(false)

    if (dbErr) {
      setError(dbErr.message)
      return
    }

    onDone(data.id)
  }

  return (
    <Card>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-900">Connect your broker</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Link your trading account via MetaAPI. Find your Account ID in your MetaAPI dashboard.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
          hint="Found in your MetaAPI Cloud dashboard under Accounts"
          required
        />
        <Input
          label="Account label (optional)"
          placeholder="e.g. My Live MT4 Account"
          value={form.label}
          onChange={e => set('label', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
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
            hint="Max pips from signal before skip"
          />
        </div>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Connect broker
        </Button>
      </form>
    </Card>
  )
}
