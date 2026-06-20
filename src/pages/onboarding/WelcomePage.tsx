import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { saveUserProfile } from '../../lib/userProfile'
import { useLocale, useT } from '../../context/LocaleContext'
import { getSubscribeCtaLabel } from '../../lib/subscriptionCta'
import { AuthBrandLogo } from '../../components/auth/AuthBrandLogo'
import { Button } from '../../components/ui/Button'

/** Post-verification welcome — email confirm or Google signup — before entering the app. */
export function WelcomePage() {
  const navigate = useNavigate()
  const t = useT()
  const { auth } = useLocale()
  const welcomeT = auth.welcome
  const { user, loading: authLoading } = useAuth()
  const { profile, refreshProfile, onboardingCompletedAt } = useUserProfile()
  const { openUpgrade, isPastDue, effectivePlan, hasTrialExpired, hasActiveSubscription } = useSubscription()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const trialCta = getSubscribeCtaLabel(t, { isPastDue, effectivePlan, hasTrialExpired })

  useEffect(() => {
    if (authLoading || !user) return
    if (onboardingCompletedAt) {
      navigate('/dashboard', { replace: true })
    }
  }, [authLoading, user, onboardingCompletedAt, navigate])

  const completeOnboarding = async () => {
    if (!user) return
    await saveUserProfile(user.id, {
      ...profile,
      onboarding_completed_at: new Date().toISOString(),
    })
    await refreshProfile()
  }

  const startFreeTrial = async () => {
    if (!user) return
    setError('')
    setSaving(true)
    try {
      await completeOnboarding()
      if (hasActiveSubscription) {
        navigate('/dashboard', { replace: true })
        return
      }
      openUpgrade('advanced')
    } catch (e) {
      setError(e instanceof Error ? e.message : welcomeT.errorFallback)
    } finally {
      setSaving(false)
    }
  }

  const exploreDashboard = async () => {
    if (!user) return
    setError('')
    setSaving(true)
    try {
      await completeOnboarding()
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : welcomeT.errorFallback)
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || !user) {
    return (
      <WelcomeShell>
        <div className="flex flex-col items-center py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
      </WelcomeShell>
    )
  }

  return (
    <WelcomeShell>
      <div className="py-6 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950/40">
          <CheckCircle2 className="h-9 w-9 text-teal-600 dark:text-teal-400" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          {welcomeT.title}
        </h1>
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">{welcomeT.subtitle}</p>

        <ul className="mt-6 space-y-2 text-left text-sm text-neutral-600 dark:text-neutral-400">
          {welcomeT.steps.map(step => (
            <li key={step} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
              <span>{step}</span>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="mt-5 text-sm text-amber-700 dark:text-amber-300">{error}</p>
        ) : null}

        <Button
          className="mt-8 w-full"
          size="lg"
          loading={saving}
          onClick={() => void startFreeTrial()}
        >
          {trialCta}
        </Button>

        <button
          type="button"
          onClick={() => void exploreDashboard()}
          disabled={saving}
          className="mt-4 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {welcomeT.exploreDashboard}
        </button>
      </div>
    </WelcomeShell>
  )
}

function WelcomeShell({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-neutral-950">
      <header className="flex shrink-0 items-center justify-center px-6 py-8 pt-[calc(2rem+env(safe-area-inset-top,0px)+var(--app-banner-h,0px))]">
        <Link to="/" className="flex items-center" aria-label="TSCopier home">
          <AuthBrandLogo className="h-8 w-auto" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-10">{children}</main>
      <footer className="shrink-0 px-6 pb-8 text-center">
        <p className="text-xs text-neutral-400 dark:text-neutral-500">© {year} Tartarix Inc.</p>
      </footer>
    </div>
  )
}
