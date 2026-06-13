import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { BrokerAccount } from '../types/database'
import { metatraderApi } from '../lib/metatraderapi'
import { brokerCanReconnect, brokerNeedsPasswordForReconnect } from '../lib/brokerReconnect'
import { classifyBrokerConnectError } from '../lib/brokerConnectError'
import {
  brokerReconnectBlockedReason,
  brokerReconnectInFlight,
  BROKER_RECONNECT_MIN_GAP_MS,
  endBrokerReconnect,
  tryBeginBrokerReconnect,
} from '../lib/brokerReconnectCoordinator'

const SILENT_RECONNECT_INTERVAL_MS = 45_000

type ReconnectResult = Awaited<ReturnType<typeof metatraderApi.reconnect>>

export interface BrokerPasswordPromptResult {
  password: string
  rememberPassword: boolean
}

export interface UseBrokerReconnectOptions {
  brokers: BrokerAccount[]
  setBrokers: Dispatch<SetStateAction<BrokerAccount[]>>
  autoReconnect?: boolean
  autoReconnectActiveOnly?: boolean
  autoReconnectPaused?: boolean
  onError?: (message: string) => void
  onClearError?: () => void
  reconnectFailedLabel: string
  requestPassword?: (brokerId: string) => Promise<BrokerPasswordPromptResult | null>
  onReconnectSuccess?: (brokerId: string) => void
}

/** Stored password exists but the broker rejected it — user must type a new one. */
const STORED_PASSWORD_REJECTED_KINDS = new Set([
  'wrong_password',
  'credentials_rejected',
  'investor_password',
])

function shouldPromptForPassword(args: {
  hasStoredPassword: boolean
  forcePasswordPrompt?: boolean
  message: string | undefined
  kind?: string | null
}): boolean {
  if (args.forcePasswordPrompt) return true
  if (args.hasStoredPassword) {
    const kind = args.kind ?? classifyBrokerConnectError(args.message)
    if (STORED_PASSWORD_REJECTED_KINDS.has(kind)) return true
    if (kind === 'unknown' && !args.message?.trim()) return true
    if (kind === 'session_expired') return true
    return false
  }
  return brokerNeedsPasswordForReconnect(args.message)
}

async function reconnectWithOptionalPassword(
  brokerId: string,
  options: {
    allowPasswordPrompt: boolean
    forcePasswordPrompt?: boolean
    hasStoredPassword: boolean
    requestPassword?: (brokerId: string) => Promise<BrokerPasswordPromptResult | null>
    reconnectFailedLabel: string
    onError?: (message: string) => void
    bypassGap?: boolean
    lockAlreadyHeld?: boolean
  },
): Promise<{ result: ReconnectResult; rememberPassword?: boolean }> {
  const acquiredLock = options.lockAlreadyHeld
    ? true
    : tryBeginBrokerReconnect(brokerId, { bypassGap: options.bypassGap })
  if (!acquiredLock) {
    const blocked = brokerReconnectBlockedReason(brokerId, { bypassGap: options.bypassGap })
    const message = blocked === 'in_flight'
      ? 'Reconnect already in progress. Please wait a moment and try again.'
      : `Please wait ${Math.ceil(BROKER_RECONNECT_MIN_GAP_MS / 1000)} seconds before retrying.`
    return {
      result: {
        ok: false,
        connection_status: 'error',
        message,
      },
    }
  }
  try {
    if (options.forcePasswordPrompt && options.requestPassword) {
      const entered = await options.requestPassword(brokerId)
      if (entered?.password.trim()) {
        const result = await metatraderApi.reconnect(brokerId, {
          password: entered.password.trim(),
          rememberPassword: entered.rememberPassword,
        })
        return { result, rememberPassword: entered.rememberPassword }
      }
      return {
        result: {
          ok: false,
          connection_status: 'error',
          message: options.reconnectFailedLabel,
        },
      }
    }

    let result = await metatraderApi.reconnect(brokerId)
    const needsPassword =
      options.allowPasswordPrompt
      && result.connection_status !== 'connected'
      && shouldPromptForPassword({
        hasStoredPassword: options.hasStoredPassword,
        forcePasswordPrompt: options.forcePasswordPrompt,
        message: result.message,
        kind: result.connection_error_kind,
      })
    if (needsPassword && options.requestPassword) {
      const entered = await options.requestPassword(brokerId)
      if (!entered?.password.trim()) {
        options.onError?.(result.message ?? options.reconnectFailedLabel)
        return { result }
      }
      result = await metatraderApi.reconnect(brokerId, {
        password: entered.password.trim(),
        rememberPassword: entered.rememberPassword,
      })
      return { result, rememberPassword: entered.rememberPassword }
    }
    return { result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : options.reconnectFailedLabel
    if (
      options.allowPasswordPrompt
      && shouldPromptForPassword({
        hasStoredPassword: options.hasStoredPassword,
        forcePasswordPrompt: options.forcePasswordPrompt,
        message: msg,
      })
      && options.requestPassword
    ) {
      const entered = await options.requestPassword(brokerId)
      if (entered?.password.trim()) {
        try {
          const result = await metatraderApi.reconnect(brokerId, {
            password: entered.password.trim(),
            rememberPassword: entered.rememberPassword,
          })
          return { result, rememberPassword: entered.rememberPassword }
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : options.reconnectFailedLabel
          options.onError?.(retryMsg)
          return {
            result: { ok: false, connection_status: 'error', message: retryMsg },
          }
        }
      }
    }
    options.onError?.(msg)
    return {
      result: { ok: false, connection_status: 'error', message: msg },
    }
  } finally {
    if (!options.lockAlreadyHeld) {
      endBrokerReconnect(brokerId)
    }
  }
}

export function useBrokerReconnect(opts: UseBrokerReconnectOptions) {
  const [reconnectingBrokerIds, setReconnectingBrokerIds] = useState<Set<string>>(() => new Set())
  const silentReconnectingRef = useRef(new Set<string>())

  const brokersNeedingReconnect = useMemo(
    () => opts.brokers.filter(brokerCanReconnect),
    [opts.brokers],
  )

  const applyReconnectResult = useCallback((
    brokerId: string,
    result: ReconnectResult,
  ) => {
    opts.setBrokers(prev =>
      prev.map(b => {
        if (b.id !== brokerId) return b
        if (result.connection_status !== 'connected' || !result.summary) {
          const unrecoverable = result.connection_error_kind === 'wrong_password'
            || result.connection_error_kind === 'credentials_rejected'
            || result.connection_error_kind === 'investor_password'
            || result.connection_error_kind === 'account_disabled'
          const useRecovering = b.auto_reconnect_enabled === true && !unrecoverable
          return {
            ...b,
            connection_status: useRecovering ? 'recovering' as const : 'error' as const,
            connection_error_kind: useRecovering
              ? null
              : (result.connection_error_kind ?? classifyBrokerConnectError(result.message)),
            connection_error_message: useRecovering
              ? null
              : (result.message ?? b.connection_error_message ?? null),
          }
        }
        return {
          ...b,
          connection_status: 'connected' as const,
          connection_error_kind: null,
          connection_error_message: null,
          last_synced_at: new Date().toISOString(),
          ...(result.summary
            ? {
                last_balance: result.summary.balance ?? b.last_balance,
                last_equity: result.summary.equity ?? b.last_equity,
                last_currency: result.summary.currency ?? b.last_currency,
              }
            : {}),
        }
      }),
    )
    if (result.connection_status === 'connected' && result.summary) {
      opts.onReconnectSuccess?.(brokerId)
    }
    if (result.message) {
      opts.onError?.(result.message)
    }
  }, [opts])

  const reconnectBroker = useCallback(async (
    brokerId: string,
    options?: { allowPasswordPrompt?: boolean; forcePasswordPrompt?: boolean },
  ) => {
    const allowPasswordPrompt = options?.allowPasswordPrompt !== false
    const forcePasswordPrompt = options?.forcePasswordPrompt === true
    const broker = opts.brokers.find(b => b.id === brokerId)
    const hasStoredPassword = broker?.auto_reconnect_enabled === true
    opts.onClearError?.()

    if (brokerReconnectInFlight(brokerId)) {
      const message = 'Reconnect already in progress. Please wait a moment and try again.'
      opts.onError?.(message)
      return {
        ok: false,
        connection_status: 'error' as const,
        message,
      }
    }

    setReconnectingBrokerIds(prev => new Set(prev).add(brokerId))
    try {
      const { result } = await reconnectWithOptionalPassword(brokerId, {
        allowPasswordPrompt,
        forcePasswordPrompt,
        hasStoredPassword,
        requestPassword: opts.requestPassword,
        reconnectFailedLabel: opts.reconnectFailedLabel,
        onError: opts.onError,
        bypassGap: true,
      })
      applyReconnectResult(brokerId, result)
      return result
    } finally {
      setReconnectingBrokerIds(prev => {
        const next = new Set(prev)
        next.delete(brokerId)
        return next
      })
    }
  }, [applyReconnectResult, opts])

  const silentReconnectBroker = useCallback(async (brokerId: string) => {
    if (silentReconnectingRef.current.has(brokerId) || brokerReconnectInFlight(brokerId)) return
    if (!tryBeginBrokerReconnect(brokerId)) return
    silentReconnectingRef.current.add(brokerId)
    try {
      const result = await metatraderApi.reconnect(brokerId)
      if (result.connection_status === 'connected') {
        opts.setBrokers(prev =>
          prev.map(b => {
            if (b.id !== brokerId) return b
            return {
              ...b,
              connection_status: 'connected' as const,
              last_synced_at: new Date().toISOString(),
              ...(result.summary
                ? {
                    last_balance: result.summary.balance ?? b.last_balance,
                    last_equity: result.summary.equity ?? b.last_equity,
                    last_currency: result.summary.currency ?? b.last_currency,
                  }
                : {}),
            }
          }),
        )
      }
    } catch {
      // Silent — no user-facing error
    } finally {
      silentReconnectingRef.current.delete(brokerId)
      endBrokerReconnect(brokerId)
    }
  }, [opts])

  useEffect(() => {
    if (!opts.autoReconnect || opts.autoReconnectPaused) return
    const activeOnly = opts.autoReconnectActiveOnly !== false
    for (const b of opts.brokers) {
      if (activeOnly && !b.is_active) continue
      if (!brokerCanReconnect(b)) continue
      void silentReconnectBroker(b.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!opts.autoReconnect || opts.autoReconnectPaused) return
    const activeOnly = opts.autoReconnectActiveOnly !== false

    const runSilentSweep = () => {
      if (opts.autoReconnectPaused || document.visibilityState !== 'visible') return
      for (const b of opts.brokers) {
        if (activeOnly && !b.is_active) continue
        if (!brokerCanReconnect(b)) continue
        void silentReconnectBroker(b.id)
      }
    }

    const timer = setInterval(runSilentSweep, SILENT_RECONNECT_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') runSilentSweep()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [opts.autoReconnect, opts.autoReconnectActiveOnly, opts.autoReconnectPaused, opts.brokers, silentReconnectBroker])

  return {
    reconnectBroker,
    silentReconnectBroker,
    reconnectingBrokerIds,
    brokersNeedingReconnect,
    isReconnecting: (brokerId: string) => reconnectingBrokerIds.has(brokerId),
  }
}
