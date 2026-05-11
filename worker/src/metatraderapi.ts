import { Agent, request } from 'undici'

/**
 * MetatraderAPI (metatraderapi.dev) Node client tuned for low order-send latency.
 *
 * - Singleton undici Agent keeps a TLS-warm connection pool to api.metatraderapi.dev,
 *   so OrderSend round-trips skip TLS handshakes after the first call.
 * - All endpoints are GET with query parameters per
 *   https://docs.metatraderapi.dev/docs/metatrader-5-api.
 */

const DEFAULT_BASE_URL = 'https://api.metatraderapi.dev'

const KEEP_ALIVE_AGENT = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
})

export type MtPlatform = 'MT4' | 'MT5'

export type MtOperation =
  | 'Buy'
  | 'Sell'
  | 'BuyLimit'
  | 'SellLimit'
  | 'BuyStop'
  | 'SellStop'
  | 'BuyStopLimit'
  | 'SellStopLimit'

export interface OrderSendArgs {
  symbol: string
  operation: MtOperation
  volume: number
  price?: number | null
  slippage?: number
  stoploss?: number | null
  takeprofit?: number | null
  comment?: string
  expertID?: number
  expiration?: string
  expirationType?: 'GTC' | 'Today' | 'Specified' | 'SpecifiedDay'
}

export interface OrderModifyArgs {
  ticket: number
  stoploss?: number | null
  takeprofit?: number | null
  price?: number | null
  expiration?: string
  expirationType?: 'GTC' | 'Today' | 'Specified' | 'SpecifiedDay'
}

export interface OrderCloseArgs {
  ticket: number
  lots?: number
  price?: number
  slippage?: number
}

export interface OrderResult {
  ticket: number
  openPrice?: number
  stopLoss?: number
  takeProfit?: number
  lots?: number
  symbol?: string
  orderType?: string
  state?: string
  closePrice?: number
  profit?: number
  swap?: number
  commission?: number
  fee?: number
  comment?: string
}

export interface AccountSummary {
  balance?: number
  credit?: number
  profit?: number
  equity?: number
  margin?: number
  freeMargin?: number
  marginLevel?: number
  leverage?: number
  currency?: string
}

export interface SymbolParams {
  symbolName?: string
  symbol?: {
    digits?: number
    point?: number
    contractSize?: number
    stopsLevel?: number
  }
  groupParams?: {
    minLot?: number
    maxLot?: number
    lotStep?: number
  }
}

export class MetatraderApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'MetatraderApiError'
    this.status = status
    this.code = code
  }
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    out.set(k, String(v))
  }
  return out.toString()
}

export class MetatraderApiClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL, timeoutMs: number = 30_000) {
    if (!apiKey) throw new Error('MetatraderApiClient: apiKey is required')
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.timeoutMs = timeoutMs
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined | null>): Promise<T> {
    const qs = buildQuery(params)
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`
    const res = await request(url, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      dispatcher: KEEP_ALIVE_AGENT,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    })
    const text = await res.body.text()
    let body: unknown = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = text }
    }
    const status = res.statusCode
    if (status < 200 || status >= 300) {
      const obj = (body && typeof body === 'object') ? body as Record<string, unknown> : null
      const msg = obj?.message ? String(obj.message)
        : obj?.error ? String(obj.error)
        : text || `HTTP ${status}`
      const code = obj?.code ? String(obj.code) : undefined
      throw new MetatraderApiError(msg, status, code)
    }
    return body as T
  }

  accountSummary(id: string): Promise<AccountSummary> {
    return this.get<AccountSummary>('/AccountSummary', { id })
  }

  checkConnect(id: string): Promise<string> {
    return this.get<string>('/CheckConnect', { id })
  }

  symbolParams(id: string, symbol: string): Promise<SymbolParams> {
    return this.get<SymbolParams>('/SymbolParams', { id, symbol })
  }

  orderSend(id: string, args: OrderSendArgs): Promise<OrderResult> {
    return this.get<OrderResult>('/OrderSend', {
      id,
      symbol: args.symbol,
      operation: args.operation,
      volume: args.volume,
      price: args.price ?? 0,
      slippage: args.slippage ?? 20,
      stoploss: args.stoploss ?? 0,
      takeprofit: args.takeprofit ?? 0,
      comment: args.comment,
      expertID: args.expertID ?? 0,
      expiration: args.expiration,
      expirationType: args.expirationType,
    })
  }

  orderModify(id: string, args: OrderModifyArgs): Promise<OrderResult> {
    return this.get<OrderResult>('/OrderModify', {
      id,
      ticket: args.ticket,
      stoploss: args.stoploss ?? 0,
      takeprofit: args.takeprofit ?? 0,
      price: args.price ?? 0,
      expiration: args.expiration,
      expirationType: args.expirationType,
    })
  }

  orderClose(id: string, args: OrderCloseArgs): Promise<OrderResult> {
    return this.get<OrderResult>('/OrderClose', {
      id,
      ticket: args.ticket,
      lots: args.lots ?? 0,
      price: args.price ?? 0,
      slippage: args.slippage ?? 20,
    })
  }
}

let cachedClient: MetatraderApiClient | null = null

export function getMetatraderApi(): MetatraderApiClient | null {
  if (cachedClient) return cachedClient
  const apiKey = process.env.METATRADERAPI_KEY?.trim() ?? ''
  if (!apiKey) return null
  const baseUrl = process.env.METATRADERAPI_BASE_URL?.trim() || DEFAULT_BASE_URL
  cachedClient = new MetatraderApiClient(apiKey, baseUrl)
  return cachedClient
}
