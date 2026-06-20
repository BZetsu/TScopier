import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { isEmailVerified } from '../../lib/emailVerification'
import { markEmailVerified } from '../../lib/markEmailVerified'
import { loadUserProfile } from '../../lib/userProfile'
import { useLocale } from '../../context/LocaleContext'

/** Landing route after the user clicks the verification link in their email. */
export function AuthConfirmedPage() {
  const navigate = useNavigate()
  const { auth } = useLocale()
  const verifyT = auth.verify
  const { user } = useAuth()
  const { refreshProfile } = useUserProfile()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        if (cancelled) return
        if (user.email_confirmed_at) {
          try {
            await markEmailVerified()
          } catch {
            /* DB trigger may have already synced */
          }
        }
        const row = await loadUserProfile(user.id)
        await refreshProfile()
        if (isEmailVerified(user, row?.email_verified_at)) {
          if (!row?.onboarding_completed_at) {
            navigate('/welcome', { replace: true })
          } else {
            navigate('/dashboard', { replace: true })
          }
          return
        }
        await new Promise(r => setTimeout(r, 400))
      }

      if (!cancelled) {
        setError(
          verifyT.confirmPending
          ?? 'Verification is still processing. Check your email for the latest link.',
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, navigate, refreshProfile, verifyT.confirmPending])

  return (
    <div className="flex flex-col items-center py-12 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-teal-600 dark:text-teal-400" aria-hidden />
      <h1 className="mt-6 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {verifyT.confirming ?? 'Confirming your email…'}
      </h1>
      {error ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{error}</p>
      ) : (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          {verifyT.confirmingHint ?? 'You will be redirected in a moment.'}
        </p>
      )}
    </div>
  )
}
