import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export interface Subscription {
  id: string
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string | null
  plan: 'basic' | 'advanced'
  status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'incomplete'
  extra_accounts: number
  trial_ends_at: string | null
  current_period_end: string | null
}

interface SubscriptionContextValue {
  subscription: Subscription | null
  loading: boolean
  hasActiveSubscription: boolean
  planName: string
  refresh: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  subscription: null,
  loading: true,
  hasActiveSubscription: false,
  planName: '',
  refresh: async () => {},
})

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null)
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    setSubscription(data as Subscription | null)
    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchSubscription()
  }, [fetchSubscription])

  const hasActiveSubscription =
    subscription?.status === 'active' || subscription?.status === 'trialing'

  const planName = subscription
    ? subscription.plan === 'advanced' ? 'Advanced' : 'Basic'
    : ''

  return (
    <SubscriptionContext.Provider
      value={{ subscription, loading, hasActiveSubscription, planName, refresh: fetchSubscription }}
    >
      {children}
    </SubscriptionContext.Provider>
  )
}

export const useSubscription = () => useContext(SubscriptionContext)
