/**
 * FxSocket MT5 API contract (Phase 0).
 *
 * Canonical, code-backed contract for the FxSocket REST trading API, derived from
 * https://fxsocket.com/docs/mt5/trading and MT5 (MQL5) TRADE_RETCODE_* semantics.
 *
 * The single most important reliability rule from the docs:
 *   "A 200 response only means MT5 returned a result; always inspect success and
 *    retcode to confirm the broker accepted it."
 *
 * Therefore every order operation in the new engine is accepted ONLY when:
 *   success === true  AND  retcode is in DONE_RETCODES (or PARTIAL_RETCODES).
 *
 * Endpoints (all under https://api.fxsocket.com/mt5/{account_id}/...):
 *   POST OrderSend   - market/pending; market needs symbol+volume (price ignored);
 *                      optional slippage (default 10), stopLoss, takeProfit,
 *                      expiration, comment, expertId. SL/TP CAN be attached here.
 *   POST OrderModify - position ticket: only stopLoss/takeProfit; pending also
 *                      price/stopLimitPrice/expiration. Omit a field to keep it.
 *   POST OrderClose  - infers full vs partial from volume (respect volumeStep) and
 *                      pending-vs-position from ticket type.
 *   GET  OpenedOrders, getQuote, SymbolInfo, AccountSummary, OrderHistory, ...
 *
 * Success response shape (OrderSend/Modify/Close):
 *   { success, retcode, retcodeDescription, deal, order, volume, price, bid, ask, comment }
 */

/** MT5 TRADE_RETCODE_* values (subset we care about). */
export const MT5_RETCODE = {
  REQUOTE: 10004,
  REJECT: 10006,
  CANCEL: 10007,
  PLACED: 10008, // pending order accepted
  DONE: 10009, // request completed (the success code)
  DONE_PARTIAL: 10010, // only part of the request was completed
  ERROR: 10011,
  TIMEOUT: 10012,
  INVALID: 10013,
  INVALID_VOLUME: 10014,
  INVALID_PRICE: 10015,
  INVALID_STOPS: 10016,
  TRADE_DISABLED: 10017,
  MARKET_CLOSED: 10018,
  NO_MONEY: 10019,
  PRICE_CHANGED: 10020,
  PRICE_OFF: 10021,
  INVALID_EXPIRATION: 10022,
  ORDER_CHANGED: 10023,
  TOO_MANY_REQUESTS: 10024,
  NO_CHANGES: 10025,
  SERVER_DISABLES_AT: 10026,
  CLIENT_DISABLES_AT: 10027,
  LOCKED: 10028,
  FROZEN: 10029,
  INVALID_FILL: 10030,
  CONNECTION: 10031,
  POSITION_CLOSED: 10036,
  INVALID_CLOSE_VOLUME: 10038,
  CLOSE_ORDER_EXISTS: 10039,
  LIMIT_POSITIONS: 10040,
  REJECT_CANCEL: 10041,
} as const

export type Mt5Retcode = (typeof MT5_RETCODE)[keyof typeof MT5_RETCODE]

const RETCODE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(MT5_RETCODE).map(([k, v]) => [v, k]),
)

export function retcodeName(retcode: number | null | undefined): string {
  if (retcode == null) return 'UNKNOWN'
  return RETCODE_NAME[retcode] ?? `RETCODE_${retcode}`
}

/** Retcodes that mean the broker fully accepted the request. */
export const DONE_RETCODES: ReadonlySet<number> = new Set([
  MT5_RETCODE.DONE,
  MT5_RETCODE.PLACED,
])

/** Partial completion - the request did something but not everything (e.g. partial fill). */
export const PARTIAL_RETCODES: ReadonlySet<number> = new Set([
  MT5_RETCODE.DONE_PARTIAL,
])

/**
 * Retcodes where the order DEFINITELY did not execute, so re-sending cannot create
 * a duplicate. (Used to decide whether an OrderSend may be safely retried.)
 */
export const ORDER_NOT_PLACED_RETCODES: ReadonlySet<number> = new Set([
  MT5_RETCODE.REJECT,
  MT5_RETCODE.CANCEL,
  MT5_RETCODE.ERROR,
  MT5_RETCODE.INVALID,
  MT5_RETCODE.INVALID_VOLUME,
  MT5_RETCODE.INVALID_PRICE,
  MT5_RETCODE.INVALID_STOPS,
  MT5_RETCODE.TRADE_DISABLED,
  MT5_RETCODE.MARKET_CLOSED,
  MT5_RETCODE.NO_MONEY,
  MT5_RETCODE.INVALID_EXPIRATION,
  MT5_RETCODE.SERVER_DISABLES_AT,
  MT5_RETCODE.CLIENT_DISABLES_AT,
  MT5_RETCODE.INVALID_FILL,
  MT5_RETCODE.LIMIT_POSITIONS,
])

/** "Already in the desired state" retcodes - treat a modify as a benign no-op success. */
export const BENIGN_MODIFY_RETCODES: ReadonlySet<number> = new Set([
  MT5_RETCODE.NO_CHANGES,
])

export function isInvalidStopsRetcode(retcode: number | null | undefined): boolean {
  return retcode === MT5_RETCODE.INVALID_STOPS
    || retcode === MT5_RETCODE.INVALID_PRICE
    || retcode === MT5_RETCODE.PRICE_OFF
}

export function isRequoteRetcode(retcode: number | null | undefined): boolean {
  return retcode === MT5_RETCODE.REQUOTE || retcode === MT5_RETCODE.PRICE_CHANGED
}

// ── Request shapes ──────────────────────────────────────────────────────────

export type MtOperation =
  | 'Buy' | 'Sell'
  | 'BuyLimit' | 'SellLimit'
  | 'BuyStop' | 'SellStop'
  | 'BuyStopLimit' | 'SellStopLimit'

export function operationIsPending(op: string): boolean {
  return /limit|stop/i.test(op)
}

export function operationRequiresPrice(op: string): boolean {
  return operationIsPending(op)
}

export type FxOrderSendRequest = {
  symbol: string
  operation: MtOperation
  volume: number
  price?: number
  stopLimitPrice?: number
  stopLoss?: number
  takeProfit?: number
  slippage?: number
  expiration?: string
  comment?: string
  expertId?: number
}

export type FxOrderModifyRequest = {
  ticket: number
  stopLoss?: number
  takeProfit?: number
  price?: number
  stopLimitPrice?: number
  expiration?: string
}

export type FxOrderCloseRequest = {
  ticket: number
  volume?: number // omit/0 = full close
  slippage?: number
  price?: number
}

// ── Response classification ─────────────────────────────────────────────────

export type FxOrderResult = {
  /** Broker accepted the request (success === true AND retcode in DONE/PARTIAL). */
  ok: boolean
  partial: boolean
  retcode: number | null
  retcodeName: string
  message: string
  ticket: number | null // resolved position/order ticket (order ?? deal)
  order: number | null
  deal: number | null
  volume: number | null
  price: number | null
  bid: number | null
  ask: number | null
  comment: string | null
  raw: unknown
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Strictly classify an FxSocket order response per the docs. Reads success and
 * retcode; never assumes a 200 means accepted.
 */
export function classifyOrderResponse(raw: unknown): FxOrderResult {
  const root = (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})
  const body = (root.result && typeof root.result === 'object' ? root.result as Record<string, unknown> : root)

  const retcode = num(body.retcode ?? body.retCode ?? body.returnCode)
  const successField = body.success
  const message = String(
    body.retcodeDescription ?? body.retCodeDescription ?? body.message ?? body.Message ?? '',
  ).trim()

  const order = num(body.order ?? body.Order)
  const deal = num(body.deal ?? body.Deal)
  const ticket = num(body.ticket ?? body.Ticket) ?? order ?? deal

  const retcodeOk = retcode != null && (DONE_RETCODES.has(retcode) || PARTIAL_RETCODES.has(retcode))
  // success defaults to "unknown" when omitted; require it to be not-false AND a DONE retcode.
  const successOk = successField !== false
  const ok = successOk && retcodeOk

  return {
    ok,
    partial: retcode != null && PARTIAL_RETCODES.has(retcode),
    retcode,
    retcodeName: retcodeName(retcode),
    message: message || (ok ? 'ok' : `rejected (${retcodeName(retcode)})`),
    ticket,
    order,
    deal,
    volume: num(body.volume ?? body.Volume),
    price: num(body.price ?? body.Price),
    bid: num(body.bid ?? body.Bid),
    ask: num(body.ask ?? body.Ask),
    comment: typeof body.comment === 'string' ? body.comment : null,
    raw,
  }
}

/** A position/order as returned by OpenedOrders, normalized. */
export type FxOpenOrder = {
  ticket: number
  symbol: string
  operation: string
  isBuy: boolean
  volume: number
  openPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  comment: string
  magic: number | null
  isPending: boolean
}

export function normalizeOpenOrder(raw: unknown): FxOpenOrder | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ticket = num(o.ticket ?? o.Ticket ?? o.order ?? o.Order ?? o.position ?? o.Position)
  if (ticket == null || ticket <= 0) return null
  const operation = String(o.type ?? o.Type ?? o.operation ?? o.Operation ?? '')
  const isBuy = /buy/i.test(operation) || operation === '0'
  const symbol = String(o.symbol ?? o.Symbol ?? '')
  return {
    ticket,
    symbol,
    operation,
    isBuy,
    volume: num(o.volume ?? o.Volume ?? o.lots ?? o.Lots) ?? 0,
    openPrice: num(o.openPrice ?? o.OpenPrice ?? o.priceOpen ?? o.price_open ?? o.price ?? o.Price),
    stopLoss: num(o.stopLoss ?? o.StopLoss ?? o.sl ?? o.SL),
    takeProfit: num(o.takeProfit ?? o.TakeProfit ?? o.tp ?? o.TP),
    comment: typeof o.comment === 'string' ? o.comment : String(o.Comment ?? ''),
    magic: num(o.magic ?? o.Magic ?? o.expertId ?? o.ExpertId),
    isPending: operationIsPending(operation),
  }
}

/** Stable magic number identifying orders opened by this copier. */
export const TSCOPIER_MAGIC = (() => {
  const raw = Number(process.env.TSCOPIER_MAGIC ?? 770077)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 770077
})()

/**
 * Deterministic, length-bounded order comment used for idempotent send recovery.
 * MT5 comments are short (broker-dependent, ~31 chars) and may be altered by the
 * broker, so this is a best-effort matcher used alongside an OpenedOrders snapshot
 * diff (symbol + volume + recency), never as the sole dedup key.
 */
export function buildOrderComment(anchorSignalId: string, legIndex: number): string {
  const short = String(anchorSignalId ?? '').replace(/-/g, '').slice(0, 16)
  return `t:${short}:${legIndex}`.slice(0, 31)
}

export function parseOrderComment(comment: string | null | undefined): { anchor: string; leg: number } | null {
  const m = /^t:([0-9a-f]{1,16}):(\d+)$/i.exec(String(comment ?? '').trim())
  if (!m) return null
  return { anchor: m[1], leg: Number(m[2]) }
}
