import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useUserProfile } from '../context/UserProfileContext'

/**
 * Auth/profile resolving gate. Welcome/trial modal was removed — paywall
 * redirects unpaid users to /pricing instead.
 */
export function useNeedsWelcome() {
  const { loading: authLoading } = useAuth()
  const { loading: profileLoading } = useUserProfile()

  return useMemo(() => {
    const resolving = authLoading || profileLoading
    return {
      needsWelcome: false,
      deferAppBootstrap: resolving,
      resolving,
    }
  }, [authLoading, profileLoading])
}
