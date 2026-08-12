import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useUserProfile } from '../context/UserProfileContext'
import { isEmailVerified } from '../lib/emailVerification'
import { loadPendingPlanSelection } from '../lib/pendingPlanSelection'

/**
 * Welcome modal gate: verified users without onboarding_completed_at.
 * Skip when a pending plan selection exists so pricing auto-checkout is not interrupted.
 */
export function useNeedsWelcome() {
  const { user, loading: authLoading } = useAuth()
  const { onboardingCompletedAt, emailVerifiedAt, loading: profileLoading } = useUserProfile()

  return useMemo(() => {
    const resolving = authLoading || profileLoading
    const hasPendingPlan = Boolean(loadPendingPlanSelection())
    const needsWelcome = Boolean(
      user
        && !resolving
        && isEmailVerified(user, emailVerifiedAt)
        && !onboardingCompletedAt
        && !hasPendingPlan,
    )
    return {
      needsWelcome,
      /** Only defer bootstrap while auth/profile is still resolving. */
      deferAppBootstrap: resolving,
      resolving,
    }
  }, [user, authLoading, profileLoading, emailVerifiedAt, onboardingCompletedAt])
}
