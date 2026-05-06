import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../../components/ui/Card'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'

type Stage = 'phone' | 'code' | 'done'

interface Props {
  onDone: (sessionId: string) => void
}

const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`

export function TelegramLinkStep({ onDone }: Props) {
  const { session } = useAuth()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [phoneCodeHash, setPhoneCodeHash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requiresPassword, setRequiresPassword] = useState(false)

  const authHeaders = {
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: 'send_code', phone }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to send code')
        return
      }

      setPhoneCodeHash(data.phone_code_hash)
      setStage('code')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'verify_code',
          phone,
          code,
          phone_code_hash: phoneCodeHash,
          password: requiresPassword ? password : undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        if (data.requires_password) {
          setRequiresPassword(true)
          setError('Two-step verification is enabled. Enter your Telegram password below.')
          setLoading(false)
          return
        }
        setError(data.error || 'Verification failed')
        return
      }

      // Save session to Supabase
      const { data: sessionRow, error: dbErr } = await supabase
        .from('telegram_sessions')
        .upsert({
          user_id: (await supabase.auth.getUser()).data.user!.id,
          session_string: data.session_string,
          phone_number: phone,
          is_active: true,
        }, { onConflict: 'user_id' })
        .select('id')
        .single()

      if (dbErr) {
        setError(dbErr.message)
        return
      }

      setStage('done')
      onDone(sessionRow.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (stage === 'done') {
    return (
      <Card>
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-success-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">Telegram connected</h2>
          <p className="text-sm text-neutral-500 mt-1">Your session is saved and active.</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-900">Link your Telegram</h2>
        <p className="text-sm text-neutral-500 mt-1">
          {stage === 'phone'
            ? 'Enter your phone number to receive a verification code.'
            : 'Enter the code Telegram sent you.'}
        </p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">
          {error}
        </div>
      )}

      {stage === 'phone' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Input
            label="Phone number"
            type="tel"
            placeholder="+1 234 567 8900"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            hint="Include country code (e.g. +44 for UK)"
            required
            autoFocus
          />
          <Button type="submit" loading={loading} className="w-full" size="lg">
            Send verification code
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <Input
            label="Verification code"
            type="text"
            placeholder="12345"
            value={code}
            onChange={e => setCode(e.target.value)}
            hint={`Code sent to ${phone}`}
            required
            autoFocus
          />
          {requiresPassword && (
            <Input
              label="Two-step verification password"
              type="password"
              placeholder="Your Telegram password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          )}
          <Button type="submit" loading={loading} className="w-full" size="lg">
            Verify and connect
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => { setStage('phone'); setError('') }}
          >
            Use a different number
          </Button>
        </form>
      )}
    </Card>
  )
}
