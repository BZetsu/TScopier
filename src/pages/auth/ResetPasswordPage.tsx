import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PasswordInput } from '../../components/auth/PasswordInput'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'
import { AuthBackHome } from '../../components/auth/AuthBackHome'
import { useLocale } from '../../context/LocaleContext'

type RecoveryState = 'checking' | 'ready' | 'invalid'

function isRecoveryHash(): boolean {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return false
  return new URLSearchParams(hash).get('type') === 'recovery'
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { auth } = useLocale()
  const t = auth.resetPassword

  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const recoveryLink = isRecoveryHash()
    let cancelled = false

    const markReady = () => {
      if (!cancelled) setRecoveryState('ready')
    }
    const markInvalid = () => {
      if (!cancelled) setRecoveryState('invalid')
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (recoveryLink && session)) {
        markReady()
      }
    })

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session && recoveryLink) {
        markReady()
        return
      }
      if (!recoveryLink) {
        markInvalid()
      }
    })

    if (recoveryLink) {
      const timeout = window.setTimeout(() => {
        void supabase.auth.getSession().then(({ data: { session } }) => {
          if (!cancelled && !session) markInvalid()
        })
      }, 5000)
      return () => {
        cancelled = true
        clearTimeout(timeout)
        subscription.unsubscribe()
      }
    }

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError(t.passwordTooShort)
      return
    }
    if (password !== confirmPassword) {
      setError(t.passwordMismatch)
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await supabase.auth.signOut()
    navigate('/login?reset=success', { replace: true })
  }

  if (recoveryState === 'checking') {
    return (
      <div className="flex w-full justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
      </div>
    )
  }

  if (recoveryState === 'invalid') {
    return (
      <div className="w-full">
        <AuthBackHome />
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
            {t.invalidHeading}
          </h1>
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">{t.invalidSubtitle}</p>
          <Link
            to="/forgot-password"
            className="mt-8 inline-flex items-center justify-center rounded-lg border border-teal-600 bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-teal-700 hover:bg-teal-700"
          >
            {t.requestNewLink}
          </Link>
          <p className="mt-4">
            <Link
              to="/login"
              className="text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
            >
              {t.backToLogin}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <AuthBackHome />
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/20">
        <KeyRound className="h-7 w-7 text-teal-600 dark:text-teal-400" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
        {t.heading}
      </h1>
      <p className="mt-2 mb-8 text-sm text-neutral-500 dark:text-neutral-400">{t.subtitle}</p>

      {error ? <Alert variant="error" className="mb-5 py-2.5">{error}</Alert> : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordInput
          label={t.password}
          placeholder={t.passwordPlaceholder}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          hint={t.passwordHint}
        />

        <PasswordInput
          label={t.confirmPassword}
          placeholder={t.confirmPasswordPlaceholder}
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        <Button type="submit" loading={loading} className="w-full !mt-6" size="lg">
          {t.submit}
        </Button>
      </form>
    </div>
  )
}
