import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import type { BrokerAccount } from '../types/database'
import { useBrokerAccountsRealtime } from '../hooks/useBrokerAccountsRealtime'
import {
  BROKER_ACCOUNT_CLIENT_SELECT,
  sortBrokerAccountsNewestFirst,
} from '../lib/brokerAccountSelect'
import { planLimitErrorMessage } from '../lib/telegramChannelApi'
import { fxsocketBroker } from '../lib/fxsocketBroker'
import { BrokerReconnectPasswordModal } from '../components/broker/BrokerReconnectPasswordModal'

interface BrokerAccountsContextValue {
  brokers: BrokerAccount[]
  loading: boolean
  loadError: string | null
  refreshBrokers: (options?: { silent?: boolean }) => Promise<BrokerAccount[]>
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>
  replaceBroker: (broker: BrokerAccount) => void
  upsertBroker: (broker: BrokerAccount) => void
  removeBroker: (id: string) => void
  patchBroker: (id: string, patch: Partial<BrokerAccount>) => void
  toggleBrokerActive: (id: string, is_active: boolean) => Promise<{ error: string | null }>
  reconnectBroker: (brokerId: string) => Promise<void>
  reconnectingBrokerIds: Set<string>
  brokersNeedingReconnect: BrokerAccount[]
  isReconnecting: (brokerId: string) => boolean
  setHealthPollingPaused: (paused: boolean) => void
  healthPollingPaused: boolean
  setBackgroundConnectivityPaused: (paused: boolean) => void
  setReconnectErrorHandler: (handler: ((message: string) => void) | null) => void
  setReconnectSuccessHandler: (handler: ((brokerId: string) => void) | null) => void
  clearStoredCredentials: (brokerId: string) => Promise<{ error: string | null }>
}

const BrokerAccountsContext = createContext<BrokerAccountsContextValue | null>(null)

export function BrokerAccountsProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  /** When false, skip broker fetch/realtime (e.g. welcome modal showing). */
  enabled?: boolean
}) {
  const { user } = useAuth()

  const [brokers, setBrokers] = useState<BrokerAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reconnectingBrokerIds, setReconnectingBrokerIds] = useState<Set<string>>(new Set())
  const initialLoadDoneRef = useRef(false)
  const reconnectErrorHandlerRef = useRef<((message: string) => void) | null>(null)
  const reconnectSuccessHandlerRef = useRef<((brokerId: string) => void) | null>(null)
  const passwordQueueRef = useRef<Array<{
    brokerId: string
    resolve: (result: { password: string; rememberPassword: boolean } | null) => void
  }>>([])
  const [passwordModalBrokerId, setPasswordModalBrokerId] = useState<string | null>(null)

  const finishPasswordRequest = useCallback((result: { password: string; rememberPassword: boolean } | null) => {
    const pending = passwordQueueRef.current.shift()
    if (!pending) return
    pending.resolve(result)
    setPasswordModalBrokerId(passwordQueueRef.current[0]?.brokerId ?? null)
  }, [])

  const requestReconnectPassword = useCallback(
    (brokerId: string): Promise<{ password: string; rememberPassword: boolean } | null> =>
      new Promise(resolve => {
        passwordQueueRef.current.push({ brokerId, resolve })
        if (passwordQueueRef.current.length === 1) {
          setPasswordModalBrokerId(brokerId)
        }
      }),
    [],
  )
  const [healthPollingPaused, setHealthPollingPaused] = useState(false)

  const refreshBrokers = useCallback(async (options?: { silent?: boolean }) => {
    if (!user?.id) {
      setBrokers([])
      setLoading(false)
      setLoadError(null)
      return []
    }
    const silent = options?.silent || initialLoadDoneRef.current
    if (!silent) setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('broker_accounts')
      .select(BROKER_ACCOUNT_CLIENT_SELECT)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
      if (!silent) setLoading(false)
      return []
    }
    const next = sortBrokerAccountsNewestFirst((data ?? []) as unknown as BrokerAccount[])
    setBrokers(next)
    initialLoadDoneRef.current = true
    setLoading(false)
    return next
  }, [user?.id])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    if (!user?.id) initialLoadDoneRef.current = false
    void refreshBrokers()
  }, [enabled, refreshBrokers, user?.id])

  const replaceBroker = useCallback((broker: BrokerAccount) => {
    setBrokers(prev => prev.map(b => (b.id === broker.id ? { ...b, ...broker } : b)))
  }, [])

  const upsertBroker = useCallback((broker: BrokerAccount) => {
    setBrokers(prev => {
      const idx = prev.findIndex(b => b.id === broker.id)
      if (idx < 0) return sortBrokerAccountsNewestFirst([...prev, broker])
      return prev.map(b => (b.id === broker.id ? { ...b, ...broker } : b))
    })
  }, [])

  const removeBroker = useCallback((id: string) => {
    setBrokers(prev => prev.filter(b => b.id !== id))
  }, [])

  const patchBroker = useCallback((id: string, patch: Partial<BrokerAccount>) => {
    setBrokers(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const toggleBrokerActive = useCallback(async (id: string, is_active: boolean) => {
    if (!user) return { error: 'Not signed in' }
    setBrokers(prev => prev.map(b => (b.id === id ? { ...b, is_active } : b)))
    const { error } = await supabase
      .from('broker_accounts')
      .update({ is_active })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) {
      setBrokers(prev => prev.map(b => (b.id === id ? { ...b, is_active: !is_active } : b)))
      return { error: planLimitErrorMessage(error.message) }
    }
    return { error: null }
  }, [user])

  useBrokerAccountsRealtime(enabled ? user?.id : undefined, setBrokers)

  const isReconnecting = useCallback((brokerId: string) => reconnectingBrokerIds.has(brokerId), [reconnectingBrokerIds])

  const reconnectBroker = useCallback(async (brokerId: string) => {
    if (!user) return
    if (reconnectingBrokerIds.has(brokerId)) return
    const broker = brokers.find(b => b.id === brokerId)
    if (!broker) return
    if (!broker.fxsocket_account_id) {
      reconnectErrorHandlerRef.current?.('This account has no FxSocket terminal link — delete it and re-add the account.')
      return
    }

    setReconnectingBrokerIds(prev => new Set(prev).add(brokerId))
    try {
      const entered = await requestReconnectPassword(brokerId)
      if (!entered?.password.trim()) return

      const { account } = await fxsocketBroker.reconnect({
        accountId: broker.fxsocket_account_id,
        password: entered.password.trim(),
      })
      setBrokers(prev => prev.map(b => (b.id === brokerId ? { ...b, ...account } : b)))

      await fxsocketBroker.waitUntilConnected(account.fxsocket_account_id ?? broker.fxsocket_account_id, {
        maxMs: 11 * 60_000,
        onProgress: result => {
          setBrokers(prev => prev.map(b => (b.id === brokerId ? { ...b, ...result.account } : b)))
        },
      })
      reconnectSuccessHandlerRef.current?.(brokerId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reconnect failed. Try again in a moment.'
      reconnectErrorHandlerRef.current?.(msg)
    } finally {
      setReconnectingBrokerIds(prev => {
        const next = new Set(prev)
        next.delete(brokerId)
        return next
      })
    }
  }, [user, brokers, reconnectingBrokerIds, requestReconnectPassword])

  const setReconnectErrorHandler = useCallback((handler: ((message: string) => void) | null) => {
    reconnectErrorHandlerRef.current = handler
  }, [])

  const setReconnectSuccessHandler = useCallback((handler: ((brokerId: string) => void) | null) => {
    reconnectSuccessHandlerRef.current = handler
  }, [])

  const clearStoredCredentials = useCallback(async () => ({ error: null as string | null }), [])

  const value = useMemo(
    (): BrokerAccountsContextValue => ({
      brokers,
      loading,
      loadError,
      refreshBrokers,
      setBrokers,
      replaceBroker,
      upsertBroker,
      removeBroker,
      patchBroker,
      toggleBrokerActive,
      reconnectBroker,
      reconnectingBrokerIds,
      brokersNeedingReconnect: [],
      isReconnecting,
      setHealthPollingPaused,
      healthPollingPaused,
      setBackgroundConnectivityPaused: () => {},
      setReconnectErrorHandler,
      setReconnectSuccessHandler,
      clearStoredCredentials,
    }),
    [
      brokers,
      loading,
      loadError,
      refreshBrokers,
      replaceBroker,
      upsertBroker,
      removeBroker,
      patchBroker,
      toggleBrokerActive,
      reconnectBroker,
      reconnectingBrokerIds,
      isReconnecting,
      healthPollingPaused,
      setReconnectErrorHandler,
      setReconnectSuccessHandler,
      clearStoredCredentials,
    ],
  )

  const passwordModalBroker = passwordModalBrokerId != null
    ? brokers.find(b => b.id === passwordModalBrokerId) ?? null
    : null

  return (
    <>
      <BrokerAccountsContext.Provider value={value}>
        {children}
      </BrokerAccountsContext.Provider>
      <BrokerReconnectPasswordModal
        open={passwordModalBroker != null}
        broker={passwordModalBroker}
        copy={{
          title: 'Reconnect broker account',
          body: 'Enter the trading password for this account to re-establish the terminal connection.',
          passwordLabel: 'Trading password',
          passwordHint: 'Use the main trading password, not the investor (read-only) password.',
          passwordPlaceholder: 'Enter password',
          rememberPasswordLabel: 'Remember password',
          rememberPasswordHint: 'Not used — kept for compatibility.',
          detailLogin: 'Login',
          detailServer: 'Server',
          reconnect: 'Reconnect',
          cancel: 'Cancel',
        }}
        onSubmit={finishPasswordRequest}
        onCancel={() => finishPasswordRequest(null)}
      />
    </>
  )
}

export function useBrokerAccounts(): BrokerAccountsContextValue {
  const ctx = useContext(BrokerAccountsContext)
  if (!ctx) {
    throw new Error('useBrokerAccounts must be used within BrokerAccountsProvider')
  }
  return ctx
}
