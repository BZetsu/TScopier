import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUserProfile } from '../../context/UserProfileContext'
import { isEmailVerified, verifyEmailPath } from '../../lib/emailVerification'
import { DashboardBootSkeleton, isDashboardBootPath } from '../dashboard/DashboardMetricsSkeleton'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const { emailVerifiedAt, loading: profileLoading } = useUserProfile()
  const location = useLocation()

  if (loading || profileLoading) {
    if (isDashboardBootPath(location.pathname)) return <DashboardBootSkeleton />
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    // Carry the attempted path into the login URL. An email link opened on a
    // device with no session lands here first, and without ?next= the visitor
    // is sent to the dashboard after sign-in instead of back to the page the
    // link pointed at. AuthPage reads ?next= through
    // capturePostAuthRedirectFromUrl, which validates it as an internal path.
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (!isEmailVerified(user, emailVerifiedAt)) {
    return <Navigate to={verifyEmailPath(user.email)} replace />
  }

  return <>{children}</>
}
