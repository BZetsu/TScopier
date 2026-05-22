import { Navigate } from 'react-router-dom'
import { useSubscription } from '../../context/SubscriptionContext'

export function SubscriptionGuard({ children }: { children: React.ReactNode }) {
  const { hasActiveSubscription, loading } = useSubscription()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasActiveSubscription) return <Navigate to="/pricing" replace />
  return <>{children}</>
}
