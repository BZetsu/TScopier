/**
 * FxSocket MT5 REST client for Deno edge functions.
 *
 * Account linking (v1): https://api.fxsocket.com/v1/docs
 *   POST /v1/accounts — link MT5 with login/password/server (X-API-Key only)
 *   GET  /v1/accounts/{id} — poll until status is connected
 *
 * Trading (per-account): https://fxsocket.com/docs#request-builder
 *   https://api.fxsocket.com/mt5/{account_id}/AccountSummary, OrderSend, …
 */

export const FXSOCKET_DOCS_REQUEST_BUILDER = "https://fxsocket.com/docs#request-builder"
export const FXSOCKET_V1_DOCS_URL = "https://api.fxsocket.com/v1/docs#/"

export const FXSOCKET_DOCUMENTED_ENDPOINTS = [
  "GET /AccountSummary",
  "GET /OpenedOrders",
  "GET /OrderHistory",
  "GET /symbols",
  "GET /getQuote",
  "GET /PriceHistory",
  "GET /SymbolInfo",
  "GET /ServerTimezone",
  "GET /OrderCalcMargin",
  "GET /OrderCalcProfit",
  "POST /OrderSend",
  "POST /OrderModify",
  "POST /OrderClose",
] as const

const DEFAULT_BASE_URL = "https://api.fxsocket.com"

export class FxsocketApiError extends Error {
  status: number
  code?: string
  commandId?: number

  constructor(message: string, status: number, code?: string, commandId?: number) {
    super(message)
    this.name = "FxsocketApiError"
    this.status = status
    this.code = code
    this.commandId = commandId
  }
}

type EnvGetter = { get(name: string): string | undefined }

function trimEnv(v: string | undefined): string {
  return (v ?? "").trim()
}

export function getFxsocketBaseUrl(env: EnvGetter): string {
  const raw = trimEnv(env.get("FXSOCKET_BASE_URL")) || DEFAULT_BASE_URL
  return raw.replace(/\/+$/, "")
}

export function getFxsocketV1BaseUrl(env: EnvGetter): string {
  return `${getFxsocketBaseUrl(env)}/v1`
}

export function resolveFxsocketApiKey(env: EnvGetter): string {
  const key = trimEnv(env.get("FXSOCKET_API_KEY"))
  if (!key) {
    throw new FxsocketApiError(
      "FXSOCKET_API_KEY is not configured on the server. Set it in Supabase Edge secrets.",
      503,
      "CONFIG_MISSING",
    )
  }
  return key
}

export function isFxsocketConfigured(env: EnvGetter): boolean {
  try {
    resolveFxsocketApiKey(env)
    return true
  } catch {
    return false
  }
}

export interface FxsocketV1Account {
  id: string
  nickname: string
  platform: string
  server: string
  login: number
  status: string
  error: string
  created_at: string
}

export interface FxsocketAccountSummary {
  balance?: number
  credit?: number
  profit?: number
  equity?: number
  margin?: number
  freeMargin?: number
  marginLevel?: number
  leverage?: number
  currency?: string
  type?: string
  isInvestor?: boolean
}

export interface FxsocketQuote {
  symbol?: string
  bid?: number
  ask?: number
  time?: string
  last?: number
  volume?: number
}

export interface FxsocketOpenedOrder {
  ticket?: number
  symbol?: string
  type?: string
  kind?: string
  lots?: number
  openPrice?: number
  currentPrice?: number
  stopLoss?: number
  takeProfit?: number
  profit?: number
  comment?: string
  openTime?: string
}

export interface FxsocketOrderResult {
  success: boolean
  retcode?: number
  retcodeDescription?: string
  deal?: number
  order?: number
  volume?: number
  price?: number
  bid?: number
  ask?: number
  comment?: string
}

export interface FxsocketTerminalStatus {
  connected?: boolean
  tradeAllowed?: boolean
  serverTime?: string
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseErrorEnvelope(body: unknown): { message: string; code?: string; commandId?: number } {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>
    if (o.detail != null) {
      const detail = o.detail
      if (typeof detail === "string") return { message: detail, code: o.error != null ? String(o.error) : undefined }
      if (Array.isArray(detail)) return { message: detail.map(String).join("; ") }
    }
    const message = String(o.message ?? o.error ?? "FxSocket request failed")
    const code = o.error != null ? String(o.error) : undefined
    const commandId = num(o.command_id)
    return { message, code, commandId }
  }
  if (typeof body === "string" && body.trim()) return { message: body.trim() }
  return { message: "FxSocket request failed" }
}

export function normalizeV1Account(raw: unknown): FxsocketV1Account {
  const o = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  return {
    id: o.id != null ? String(o.id) : "",
    nickname: o.nickname != null ? String(o.nickname) : "",
    platform: o.platform != null ? String(o.platform) : "",
    server: o.server != null ? String(o.server) : "",
    login: num(o.login) ?? 0,
    status: o.status != null ? String(o.status) : "",
    error: o.error != null ? String(o.error) : "",
    created_at: o.created_at != null ? String(o.created_at) : "",
  }
}

/** Build POST /v1/accounts body per OpenAPI schema V1CreateAccount. */
export function buildV1CreateAccountBody(args: {
  login: string | number
  password: string
  server: string
  nickname?: string
}): Record<string, unknown> {
  const loginNum = Number(String(args.login).trim())
  if (!Number.isFinite(loginNum) || loginNum < 1) {
    throw new FxsocketApiError("Invalid MT5 login number", 400)
  }
  const body: Record<string, unknown> = {
    login: loginNum,
    password: args.password,
    server: args.server.trim(),
  }
  const nickname = args.nickname?.trim()
  if (nickname) body.nickname = nickname
  return body
}

export function normalizeAccountSummary(raw: unknown): FxsocketAccountSummary {
  const o = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  return {
    balance: num(o.balance),
    credit: num(o.credit),
    profit: num(o.profit),
    equity: num(o.equity),
    margin: num(o.margin),
    freeMargin: num(o.freeMargin ?? o.free_margin),
    marginLevel: num(o.marginLevel ?? o.margin_level),
    leverage: num(o.leverage),
    currency: o.currency != null ? String(o.currency) : undefined,
    type: o.type != null ? String(o.type) : undefined,
    isInvestor: o.isInvestor === true || o.is_investor === true,
  }
}

export function normalizeOrderResponse(raw: unknown): FxsocketOrderResult {
  const o = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  return {
    success: o.success === true,
    retcode: num(o.retcode),
    retcodeDescription: o.retcodeDescription != null ? String(o.retcodeDescription) : undefined,
    deal: num(o.deal),
    order: num(o.order),
    volume: num(o.volume),
    price: num(o.price),
    bid: num(o.bid),
    ask: num(o.ask),
    comment: o.comment != null ? String(o.comment) : undefined,
  }
}

export function trimPreview(value: unknown, maxLen = 400): unknown {
  if (value == null) return value
  const text = JSON.stringify(value)
  if (text.length <= maxLen) return value
  return { _preview: `${text.slice(0, maxLen)}…` }
}

export class FxsocketClient {
  private apiKey: string
  private baseUrl: string
  private v1BaseUrl: string

  constructor(env: EnvGetter) {
    this.apiKey = resolveFxsocketApiKey(env)
    this.baseUrl = getFxsocketBaseUrl(env)
    this.v1BaseUrl = getFxsocketV1BaseUrl(env)
  }

  accountBase(accountId: string): string {
    const id = String(accountId ?? "").trim()
    if (!id) throw new FxsocketApiError("account_id required", 400)
    return `${this.baseUrl}/mt5/${encodeURIComponent(id)}`
  }

  private async request(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const timeoutMs = init.timeoutMs ?? 60_000
    const headers = new Headers(init.headers)
    headers.set("X-API-Key", this.apiKey)
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, { ...init, headers, signal: controller.signal })
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new FxsocketApiError("FxSocket request timed out", 504, "TIMEOUT")
      }
      throw new FxsocketApiError(e instanceof Error ? e.message : "FxSocket network error", 502)
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let body: unknown = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = text }
    }

    if (!res.ok) {
      const err = parseErrorEnvelope(body)
      if (res.status === 404 && url.includes("/mt5/")) {
        throw new FxsocketApiError(
          "FxSocket account or endpoint not found. Check the account UUID and that the terminal is running.",
          404,
          err.code,
          err.commandId,
        )
      }
      throw new FxsocketApiError(err.message, res.status, err.code, err.commandId)
    }
    return body
  }

  /** Link MT5 account via POST /v1/accounts (API key only). */
  async connectAccount(args: {
    login: string | number
    password: string
    server: string
    label?: string
  }): Promise<{ accountId: string; raw: unknown; v1Account: FxsocketV1Account }> {
    const payload = buildV1CreateAccountBody({
      login: args.login,
      password: args.password,
      server: args.server,
      nickname: args.label,
    })
    const raw = await this.request(`${this.v1BaseUrl}/accounts`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 120_000,
    })
    const v1Account = normalizeV1Account(raw)
    if (!v1Account.id) {
      throw new FxsocketApiError("FxSocket link succeeded but no account id was returned.", 502, "CONNECT_NO_ID")
    }
    return { accountId: v1Account.id, raw, v1Account }
  }

  async listAccounts(): Promise<FxsocketV1Account[]> {
    const raw = await this.request(`${this.v1BaseUrl}/accounts`, { method: "GET" })
    return Array.isArray(raw) ? raw.map(normalizeV1Account) : []
  }

  async getV1Account(accountId: string): Promise<FxsocketV1Account> {
    const raw = await this.request(
      `${this.v1BaseUrl}/accounts/${encodeURIComponent(accountId)}`,
      { method: "GET" },
    )
    return normalizeV1Account(raw)
  }

  async accountSummary(accountId: string): Promise<FxsocketAccountSummary> {
    const raw = await this.request(`${this.accountBase(accountId)}/AccountSummary`, { method: "GET" })
    return normalizeAccountSummary(raw)
  }

  async openedOrders(accountId: string): Promise<FxsocketOpenedOrder[]> {
    const raw = await this.request(`${this.accountBase(accountId)}/OpenedOrders`, { method: "GET" })
    return Array.isArray(raw) ? raw as FxsocketOpenedOrder[] : []
  }

  async getQuote(accountId: string, symbol: string): Promise<FxsocketQuote> {
    const q = encodeURIComponent(symbol.trim())
    const raw = await this.request(`${this.accountBase(accountId)}/getQuote?symbol=${q}`, { method: "GET" })
    return (raw && typeof raw === "object") ? raw as FxsocketQuote : {}
  }

  async symbolInfo(accountId: string, symbol: string): Promise<Record<string, unknown>> {
    const q = encodeURIComponent(symbol.trim())
    const raw = await this.request(`${this.accountBase(accountId)}/SymbolInfo?symbol=${q}`, { method: "GET" })
    return (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  }

  async symbols(accountId: string): Promise<string[]> {
    const raw = await this.request(`${this.accountBase(accountId)}/symbols`, { method: "GET" })
    return Array.isArray(raw) ? raw.map(String) : []
  }

  async orderHistory(accountId: string, from: string, to: string): Promise<unknown[]> {
    const qFrom = encodeURIComponent(from.trim())
    const qTo = encodeURIComponent(to.trim())
    const raw = await this.request(
      `${this.accountBase(accountId)}/OrderHistory?from=${qFrom}&to=${qTo}`,
      { method: "GET", timeoutMs: 90_000 },
    )
    return Array.isArray(raw) ? raw : []
  }

  async priceHistory(
    accountId: string,
    args: { symbol: string; timeframe: string; from: string; to: string },
  ): Promise<unknown> {
    const params = new URLSearchParams({
      symbol: args.symbol.trim(),
      timeframe: args.timeframe.trim(),
      from: args.from.trim(),
      to: args.to.trim(),
    })
    return await this.request(
      `${this.accountBase(accountId)}/PriceHistory?${params.toString()}`,
      { method: "GET", timeoutMs: 90_000 },
    )
  }

  async serverTimezone(accountId: string): Promise<Record<string, unknown>> {
    const raw = await this.request(`${this.accountBase(accountId)}/ServerTimezone`, { method: "GET" })
    return (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  }

  async orderSend(accountId: string, payload: Record<string, unknown>): Promise<FxsocketOrderResult> {
    const raw = await this.request(`${this.accountBase(accountId)}/OrderSend`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    })
    return normalizeOrderResponse(raw)
  }

  async orderModify(accountId: string, payload: Record<string, unknown>): Promise<FxsocketOrderResult> {
    const raw = await this.request(`${this.accountBase(accountId)}/OrderModify`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    })
    return normalizeOrderResponse(raw)
  }

  async orderClose(accountId: string, payload: Record<string, unknown>): Promise<FxsocketOrderResult> {
    const raw = await this.request(`${this.accountBase(accountId)}/OrderClose`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    })
    return normalizeOrderResponse(raw)
  }

  /** Unlink account via DELETE /v1/accounts/{id}. */
  async deleteAccount(accountId: string): Promise<void> {
    try {
      await this.request(
        `${this.v1BaseUrl}/accounts/${encodeURIComponent(accountId)}`,
        { method: "DELETE", timeoutMs: 30_000 },
      )
    } catch (e) {
      console.warn("[fxsocketClient] deleteAccount failed:", e instanceof Error ? e.message : e)
    }
  }

  /** Poll GET /v1/accounts/{id} until connected, then fetch AccountSummary. */
  async pollUntilReady(
    accountId: string,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<{ summary: FxsocketAccountSummary; v1Account: FxsocketV1Account; terminal?: FxsocketTerminalStatus }> {
    const timeoutMs = opts?.timeoutMs ?? 180_000
    const intervalMs = opts?.intervalMs ?? 3_000
    const started = Date.now()
    let lastV1: FxsocketV1Account | null = null

    while (Date.now() - started < timeoutMs) {
      const v1Account = await this.getV1Account(accountId)
      lastV1 = v1Account
      if (v1Account.status === "connected") {
        try {
          const summary = await this.accountSummary(accountId)
          return { summary, v1Account, terminal: { connected: true } }
        } catch (e) {
          if (e instanceof FxsocketApiError && e.status === 401) throw e
        }
      }
      if (v1Account.status === "error") {
        throw new FxsocketApiError(
          v1Account.error || "FxSocket terminal connection failed",
          502,
          "CONNECT_ERROR",
        )
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }

    const msg = lastV1?.error
      || `Terminal did not reach connected status (last: ${lastV1?.status || "unknown"})`
    throw new FxsocketApiError(msg, 504, "CONNECT_TIMEOUT")
  }
}

export function makeFxsocketClientFromEnv(env: EnvGetter): FxsocketClient {
  return new FxsocketClient(env)
}
