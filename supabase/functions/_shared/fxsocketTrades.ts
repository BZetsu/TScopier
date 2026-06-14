import type { FxsocketClient } from "./fxsocketClient.ts"
import {
  adjustMtTradesPositionDirection,
  flattenMtOrder,
  ingestMtHistoryRows,
  pickMtField,
  reconcileTradeDirectionWithStops,
  resolveMtDealProfit,
  resolveMtLots,
  resolveMtPositionTicket,
  type MtHistoryProfile,
  type RawMtOrder,
} from "./mtTradeFields.ts"

type RawOrder = Record<string, unknown>

export interface FxsocketBrokerTradeRow {
  id: string
  broker_id: string
  broker_label: string
  broker_name: string | null
  ticket: number
  position_ticket?: number | null
  symbol: string
  direction: "buy" | "sell" | ""
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
  status: "open" | "closed"
}

type BrokerRow = {
  id: string
  label: string
  broker_name: string | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const codeMapMt5: Record<number, { direction: "buy" | "sell" | ""; label: string }> = {
  0: { direction: "buy", label: "Buy" },
  1: { direction: "sell", label: "Sell" },
  2: { direction: "buy", label: "Buy Limit" },
  3: { direction: "sell", label: "Sell Limit" },
  4: { direction: "buy", label: "Buy Stop" },
  5: { direction: "sell", label: "Sell Stop" },
  6: { direction: "buy", label: "Buy Stop Limit" },
  7: { direction: "sell", label: "Sell Stop Limit" },
  8: { direction: "", label: "Close By" },
}

function resolveDirection(order: RawOrder, historyProfile: MtHistoryProfile): { direction: "buy" | "sell" | ""; type_label: string } {
  const pick = (...keys: string[]) => pickMtField(order, historyProfile, ...keys)
  const stringCandidate = pick("type", "Type", "orderType", "OrderType", "dealType", "DealType")
  if (typeof stringCandidate === "string" && stringCandidate.trim()) {
    const cleaned = stringCandidate.replace(/^(OrderType_|DealType_|DEAL_TYPE_|ORDER_TYPE_|POSITION_TYPE_|PositionType_)/i, "").trim()
    const lower = cleaned.toLowerCase()
    const direction: "buy" | "sell" | "" =
      lower.startsWith("buy") ? "buy"
      : lower.startsWith("sell") ? "sell"
      : lower.includes("buy") ? "buy"
      : lower.includes("sell") ? "sell"
      : ""
    const label = cleaned.replace(/([a-z])([A-Z])/g, "$1 $2")
    if (direction || label) return { direction, type_label: label || cleaned }
  }
  const numericCandidate = pick("type", "Type", "orderType", "OrderType", "dealType", "DealType", "cmd", "Cmd")
  if (typeof numericCandidate === "number" && codeMapMt5[numericCandidate]) {
    const m = codeMapMt5[numericCandidate]
    return { direction: m.direction, type_label: m.label }
  }
  return { direction: "", type_label: "" }
}

function isBalanceOpType(typeLabel: string): boolean {
  const type = typeLabel.toLowerCase()
  return (
    type.includes("balance") ||
    type.includes("credit") ||
    type.includes("deposit") ||
    type.includes("withdraw") ||
    type.includes("correction") ||
    type.includes("transfer")
  )
}

function isNonTradeEntry(direction: string, typeLabel: string, lotSize: number): boolean {
  if (isBalanceOpType(typeLabel)) return true
  return direction === "" && lotSize <= 0
}

function normalizeOrder(
  order: RawOrder,
  broker: BrokerRow,
  status: "open" | "closed",
  historyProfile: MtHistoryProfile,
): FxsocketBrokerTradeRow {
  const row = historyProfile === "trades" ? flattenMtOrder(order, "trades") : order
  const ticket = Number(pickMtField(row, historyProfile, "ticket", "Ticket") ?? 0)
  const positionTicket = historyProfile === "trades" ? resolveMtPositionTicket(order, "trades") : null
  const resolved = resolveDirection(row, historyProfile)
  const adjusted =
    status === "closed" && historyProfile === "trades"
      ? adjustMtTradesPositionDirection(order, historyProfile, resolved)
      : resolved
  const lot_size = resolveMtLots(row, historyProfile)
  const entry_price = num(pickMtField(row, historyProfile, "openPrice", "OpenPrice", "price"))
  const sl = num(pickMtField(row, historyProfile, "stopLoss", "StopLoss", "sl"))
  const tp = num(pickMtField(row, historyProfile, "takeProfit", "TakeProfit", "tp"))
  const { direction, type_label } = reconcileTradeDirectionWithStops(
    adjusted.direction,
    entry_price,
    sl,
    tp,
  )
  const openTime = pickMtField(
    row,
    historyProfile,
    "openTime", "OpenTime", "open_time", "timeOpen", "TimeOpen",
  ) as string | undefined
  const closeTime = pickMtField(
    row,
    historyProfile,
    "closeTime", "CloseTime", "close_time", "timeClose", "TimeClose", "doneTime", "DoneTime",
  ) as string | undefined
  return {
    id: `${broker.id}:${ticket}`,
    broker_id: broker.id,
    broker_label: broker.label,
    broker_name: broker.broker_name,
    ticket,
    position_ticket: positionTicket,
    symbol: String(pickMtField(row, historyProfile, "symbol", "Symbol") ?? ""),
    direction,
    type: type_label,
    lot_size,
    entry_price,
    sl,
    tp,
    close_price: num(pickMtField(row, historyProfile, "closePrice", "ClosePrice")),
    profit: isNonTradeEntry(direction, type_label, lot_size) && !isBalanceOpType(type_label)
      ? null
      : resolveMtDealProfit(row, historyProfile),
    swap: num(pickMtField(row, historyProfile, "swap", "Swap")),
    commission: num(pickMtField(row, historyProfile, "commission", "Commission")),
    comment: (pickMtField(row, historyProfile, "comment", "Comment") as string | undefined) ?? null,
    magic: num(pickMtField(row, historyProfile, "magicNumber", "MagicNumber", "magic", "Magic")),
    opened_at: openTime ?? null,
    closed_at: closeTime ?? null,
    state: (pickMtField(row, historyProfile, "state", "State") as string | undefined) ?? null,
    status,
  }
}

export async function fetchFxsocketBrokerTrades(
  fx: FxsocketClient,
  broker: BrokerRow & { fxsocket_account_id: string },
  opts: {
    scope: string
    historyFrom: string
    historyTo: string
    historyProfile: MtHistoryProfile
    limit: number
  },
): Promise<FxsocketBrokerTradeRow[]> {
  const sessionId = String(broker.fxsocket_account_id ?? "").trim()
  if (!sessionId) return []

  const wantOpen = opts.scope === "all" || opts.scope === "open"
  const wantClosed = opts.scope === "all" || opts.scope === "closed"

  const [openedRes, closedRes] = await Promise.allSettled([
    wantOpen ? fx.openedOrders(sessionId) : Promise.resolve([] as unknown[]),
    wantClosed
      ? fetchClosedHistoryForBaseline(fx, broker, {
        historyFrom: opts.historyFrom,
        historyTo: opts.historyTo,
        historyProfile: opts.historyProfile,
      })
      : Promise.resolve([] as FxsocketBrokerTradeRow[]),
  ])

  const out: FxsocketBrokerTradeRow[] = []
  if (openedRes.status === "fulfilled" && Array.isArray(openedRes.value)) {
    for (const o of openedRes.value as RawOrder[]) {
      out.push(normalizeOrder(o, broker, "open", opts.historyProfile))
    }
  }
  if (closedRes.status === "fulfilled" && Array.isArray(closedRes.value)) {
    out.push(...closedRes.value)
  }

  return out.sort((a, b) => {
    const at = a.status === "closed" ? (a.closed_at ?? a.opened_at) : a.opened_at
    const bt = b.status === "closed" ? (b.closed_at ?? b.opened_at) : b.opened_at
    const av = at ? Date.parse(at) : 0
    const bv = bt ? Date.parse(bt) : 0
    return bv - av
  }).slice(0, opts.limit > 0 ? opts.limit : undefined)
}

const BASELINE_HISTORY_CHUNK_DAYS = 45

function parseHistoryIso(iso: string): Date {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d : new Date()
}

function formatHistoryChunk(d: Date): string {
  return d.toISOString().slice(0, 19)
}

function buildHistoryChunks(fromIso: string, toIso: string): Array<{ from: string; to: string }> {
  const start = parseHistoryIso(fromIso)
  const end = parseHistoryIso(toIso)
  if (end.getTime() <= start.getTime()) {
    return [{ from: fromIso, to: toIso }]
  }

  const chunks: Array<{ from: string; to: string }> = []
  let cursor = new Date(start)
  while (cursor.getTime() < end.getTime()) {
    const chunkEnd = new Date(cursor)
    chunkEnd.setDate(chunkEnd.getDate() + BASELINE_HISTORY_CHUNK_DAYS)
    const boundedEnd = chunkEnd.getTime() > end.getTime() ? end : chunkEnd
    chunks.push({
      from: formatHistoryChunk(cursor),
      to: formatHistoryChunk(boundedEnd),
    })
    cursor = new Date(boundedEnd)
    cursor.setDate(cursor.getDate() + 1)
  }
  return chunks.length > 0 ? chunks : [{ from: fromIso, to: toIso }]
}

/** Full closed history for baseline inference — chunked fetches + ticket dedupe. */
export async function fetchClosedHistoryForBaseline(
  fx: FxsocketClient,
  broker: BrokerRow & { fxsocket_account_id: string },
  opts: {
    historyFrom: string
    historyTo: string
    historyProfile: MtHistoryProfile
  },
): Promise<FxsocketBrokerTradeRow[]> {
  const sessionId = String(broker.fxsocket_account_id ?? "").trim()
  if (!sessionId) return []

  const merged = new Map<string, RawMtOrder>()
  const chunks = buildHistoryChunks(opts.historyFrom, opts.historyTo)
  const settled = await Promise.allSettled(
    chunks.map(chunk => fx.orderHistory(sessionId, chunk.from, chunk.to)),
  )

  for (const result of settled) {
    if (result.status !== "fulfilled") continue
    ingestMtHistoryRows(merged, result.value, opts.historyProfile)
  }

  const out: FxsocketBrokerTradeRow[] = []
  for (const row of merged.values()) {
    out.push(normalizeOrder(row, broker, "closed", opts.historyProfile))
  }

  return out.sort((a, b) => {
    const av = rowCloseMs(a)
    const bv = rowCloseMs(b)
    return bv - av
  })
}

function rowCloseMs(row: Pick<FxsocketBrokerTradeRow, "closed_at" | "opened_at">): number {
  const iso = row.closed_at ?? row.opened_at
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}
