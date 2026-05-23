import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { hasAuthPresenceCookie } from '../lib/authPresenceCookie'

/**
 * Marketing runs on tscopier.ai; the app runs on app.tscopier.ai — separate localStorage.
 * A shared cookie (set on the app host when logged in) lets the landing show Dashboard.
 */
export function useMarketingAuthState() {
  const { user, loading: authLoading } = useAuth()
  const [cookieSignedIn, setCookieSignedIn] = useState(() => hasAuthPresenceCookie())

  const syncCookie = useCallback(() => {
    setCookieSignedIn(hasAuthPresenceCookie())
  }, [])

  useEffect(() => {
    syncCookie()
    window.addEventListener('focus', syncCookie)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncCookie()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', syncCookie)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [syncCookie])

  const isSignedIn = !!user || cookieSignedIn

  return {
    loading: authLoading && !cookieSignedIn,
    isSignedIn,
  }
}
