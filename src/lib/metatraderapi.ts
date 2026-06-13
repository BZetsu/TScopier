import { supabase } from './supabase'
import type { BrokerAccount } from '../types/database'

interface CallOpts<T> {
  body: Record<string, unknown>
  expect?: (body: unknown) => T
  timeoutMs?: number
}

const BROKER_EDGE_TIMEOUT_MS = 120_000
const BROKER_RECONNECT_TIMEOUT_MS = 90_000

function brokerFetchError(e: unknown, fallback: string): Error {
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return new Error('Broker request timed out. Try again in a moment.')
  }
  if (e instanceof Error && e.name === 'AbortError') {
    return new Error('Broker request timed out. Try again in a moment.')
  }
  return e instanceof Error ? e : new Error(fallback)
}

/** Validate / refresh the Supabase JWT before edge calls (avoids stale-session 401s). */
export async function ensureFreshAuthSession(): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')

  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  const token = session?.access_token
  if (!token) throw new Error('Not signed in')

  const expiresAt = session.expires_at ?? 0
  const nowSec = Math.floor(Date.now() / 1000)
  if (expiresAt - nowSec > 120) return token

  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
  if (refreshErr || !refreshed.session?.access_token) return token
  return refreshed.session.access_token
}

async function call<T = unknown>(opts: CallOpts<T>): Promise<T> {
  const token = await ensureFreshAuthSession()

  const url = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/broker-metatrader'
  const timeoutMs = opts.timeoutMs ?? BROKER_EDGE_TIMEOUT_MS
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw brokerFetchError(e, 'Broker request failed')
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : text || `HTTP ${res.status}`
    if (res.status === 504) {
      throw new Error('Trade history timed out loading from your broker. Try Refresh in a moment.')
    }
    throw new Error(msg)
  }
  return (opts.expect ? opts.expect(body) : (body as T))
}

export interface RegisterArgs {
  platform: 'MT4' | 'MT5'
  server: string
  login: string
  password: string
  label?: string
  signal_channel_ids?: string[]
  remember_password?: boolean
}

export interface BrokerSearchResult {
  name?: string
  access?: string[]
}

export interface BrokerSearchCompany {
  companyName?: string
  results?: BrokerSearchResult[]
}

export interface AccountSummary {
  balance?: number
  equity?: number
  currency?: string
  margin?: number
  freeMargin?: number
  marginLevel?: number
  leverage?: number
  /** Floating P/L across open positions, as reported by MT. */
  profit?: number
  credit?: number
  /** MT account trade mode label or code (e.g. ACCOUNT_TRADE_MODE_DEMO). */
  type?: string
}

export const metatraderApi = {
  searchBrokers(args: {
    platform: 'MT4' | 'MT5'
    company: string
  }): Promise<{ companies: BrokerSearchCompany[] }> {
    return call({
      body: { action: 'search_brokers', platform: args.platform, company: args.company },
      expect: (b) => {
        const row = b as { ok?: boolean; companies?: BrokerSearchCompany[] }
        return { companies: row.companies ?? [] }
      },
    })
  },

  register(args: RegisterArgs): Promise<{ broker: BrokerAccount; summary: AccountSummary | null }> {
    return call({
      body: { action: 'register', ...args },
      expect: (b) => b as { broker: BrokerAccount; summary: AccountSummary | null },
    })
  },

  remove(brokerId: string): Promise<{ ok: true }> {
    return call({
      body: { action: 'delete', broker_id: brokerId },
      expect: (b) => b as { ok: true },
    })
  },

  summary(
    brokerId: string,
    opts?: { calendarDay?: string; timezoneOffsetMinutes?: number },
  ): Promise<{
    summary: AccountSummary
    open_positions: number | null
    reconciled_closed?: number
    performance_baseline_balance?: number | null
    day_start_balance?: number | null
    day_start_balance_on?: string | null
    todays_profit_from_balance?: number | null
    /** True when balance is cached because live AccountSummary failed. */
    stale?: boolean
    connection_status?: string
    message?: string
  }> {
    return call({
      body: {
        action: 'summary',
        broker_id: brokerId,
        ...(opts?.calendarDay ? { calendar_day: opts.calendarDay } : {}),
        ...(opts?.timezoneOffsetMinutes != null
          ? { timezone_offset_minutes: opts.timezoneOffsetMinutes }
          : {}),
      },
      expect: (b) =>
        b as {
          summary: AccountSummary
          open_positions: number | null
          reconciled_closed?: number
          performance_baseline_balance?: number | null
          day_start_balance?: number | null
          day_start_balance_on?: string | null
          todays_profit_from_balance?: number | null
          stale?: boolean
          connection_status?: string
          message?: string
        },
    })
  },

  pnlQuick(brokerIds: string[]): Promise<{
    accounts: Array<{ id: string; profit: number | null; equity: number | null; balance: number | null }>
  }> {
    return call({
      body: { action: 'pnl_quick', broker_ids: brokerIds },
      expect: (b) => b as {
        accounts: Array<{ id: string; profit: number | null; equity: number | null; balance: number | null }>
      },
    })
  },

  check(brokerId: string): Promise<{ connected: boolean; message?: string }> {
    return call({
      body: { action: 'check', broker_id: brokerId },
      expect: (b) => {
        const row = b as { ok?: boolean; result?: string; message?: string; error?: string }
        if (row.ok === false || row.result === 'disconnected') {
          return {
            connected: false,
            message: row.message ?? row.error ?? 'Broker session is not connected',
          }
        }
        return { connected: true }
      },
    })
  },

  reconnect(
    brokerId: string,
    opts?: { password?: string; rememberPassword?: boolean },
  ): Promise<{
    ok: boolean
    connection_status: 'connected' | 'error'
    message?: string
    connection_error_kind?: string
    summary?: AccountSummary | null
  }> {
    return call({
      body: {
        action: 'reconnect',
        broker_id: brokerId,
        ...(opts?.password?.trim() ? { password: opts.password.trim() } : {}),
        ...(opts?.rememberPassword !== undefined
          ? { remember_password: opts.rememberPassword }
          : {}),
      },
      timeoutMs: BROKER_RECONNECT_TIMEOUT_MS,
      expect: (b) =>
        b as {
          ok: boolean
          connection_status: 'connected' | 'error'
          message?: string
          connection_error_kind?: string
          summary?: AccountSummary | null
        },
    })
  },

  clearStoredCredentials(brokerId: string): Promise<{ ok: true; broker: BrokerAccount | null }> {
    return call({
      body: { action: 'clear_stored_credentials', broker_id: brokerId },
      expect: (b) => b as { ok: true; broker: BrokerAccount | null },
    })
  },

  trades(args: {
    brokerId?: string
    scope?: 'all' | 'open' | 'closed'
    /** OrderHistory range (yyyy-MM-ddTHH:mm:ss). Defaults: last 90 days → now. */
    historyFrom?: string
    historyTo?: string
    /**
     * `dashboard` — charts / Today's profit (position-level merge, no deal-internal flatten).
     * `trades` — Account Trades page (deal-level rows + nested profit/lots).
     */
    historyProfile?: 'dashboard' | 'trades'
    /** Cap results after sorting newest-first (server-side). */
    limit?: number
  } = {}): Promise<{ trades: MtTrade[]; debug?: { raw_sample_keys: string[]; raw_sample: Record<string, unknown> } }> {
    return call({
      body: {
        action: 'trades',
        broker_id: args.brokerId ?? '',
        scope: args.scope ?? 'all',
        history_profile: args.historyProfile ?? 'dashboard',
        ...(args.historyFrom ? { history_from: args.historyFrom } : {}),
        ...(args.historyTo ? { history_to: args.historyTo } : {}),
        ...(args.limit != null && args.limit > 0 ? { limit: args.limit } : {}),
      },
      expect: (b) => b as { trades: MtTrade[]; debug?: { raw_sample_keys: string[]; raw_sample: Record<string, unknown> } },
    })
  },
}

export interface MtTrade {
  id: string
  broker_id: string
  broker_label: string
  broker_name: string | null
  ticket: number
  /** Opening position ticket on MT5 close deals (for channel attribution). */
  position_ticket?: number | null
  symbol: string
  /** Normalized direction. 'buy' or 'sell' for tradeable orders, '' for non-trade entries (e.g. balance). */
  direction: 'buy' | 'sell' | ''
  /** Human-readable order type label, e.g. 'Buy', 'Sell', 'Buy Limit', 'Sell Stop', 'Balance'. */
  type: string
  lot_size: number
  entry_price: number | null
  sl: number | null
  tp: number | null
  close_price: number | null
  profit: number | null
  swap: number | null
  commission: number | null
  comment: string | null
  magic: number | null
  opened_at: string | null
  closed_at: string | null
  state: string | null
  status: 'open' | 'closed'
}
