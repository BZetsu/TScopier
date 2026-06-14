/** Parse FxSocket WebSocket `account` topic payloads (camelCase or PascalCase). */
export interface FxsocketAccountStreamSnapshot {
  balance?: number
  equity?: number
  openPnl?: number
  currency?: string
}

function readNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function readStr(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s.length > 0 ? s : undefined
}

export function parseFxsocketAccountStreamData(raw: Record<string, unknown>): FxsocketAccountStreamSnapshot {
  const balance = readNum(raw.balance ?? raw.Balance)
  const equity = readNum(raw.equity ?? raw.Equity)
  const profit = readNum(raw.profit ?? raw.Profit)
  const openPnl =
    profit ??
    (balance != null && equity != null ? equity - balance : undefined)
  return {
    balance,
    equity: equity ?? balance,
    openPnl,
    currency: readStr(raw.currency ?? raw.Currency),
  }
}

function readRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function rawOrderOperation(o: Record<string, unknown>): string {
  return String(o.operation ?? o.Operation ?? o.type ?? o.Type ?? '').toLowerCase()
}

function rawNumericOrderKind(o: Record<string, unknown>): number | undefined {
  const pick = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }
  return pick(o.type ?? o.Type ?? o.orderType ?? o.OrderType ?? o.cmd ?? o.Cmd)
}

/** True for resting stop/limit rows (not filled market positions). */
export function isFxsocketPendingOrderRow(raw: unknown): boolean {
  const o = readRecord(raw)
  if (!o) return false
  const kind = String(o.kind ?? o.Kind ?? '').toLowerCase()
  if (kind === 'pending' || kind === 'order') return true
  if (kind === 'position' || kind === 'deal') return false
  const op = rawOrderOperation(o)
  if (op.includes('limit') || op.includes('stop')) return true
  const ot = String(o.orderType ?? o.OrderType ?? '').toLowerCase()
  if (ot.includes('limit') || ot.includes('stop')) return true
  const t = rawNumericOrderKind(o)
  if (t != null && t >= 2 && t <= 5) return true
  if (o.pending === true || o.isPending === true) return true
  const st = String(o.state ?? o.State ?? '').toLowerCase()
  if (st === 'placed') return true
  return false
}

/** True for executed market positions in FxSocket order/position payloads. */
export function isFxsocketMarketPositionRow(raw: unknown): boolean {
  const o = readRecord(raw)
  if (!o) return false
  if (isFxsocketPendingOrderRow(o)) return false
  const kind = String(o.kind ?? o.Kind ?? '').toLowerCase()
  if (kind === 'position' || kind === 'deal') return true
  const op = rawOrderOperation(o).replace(/\s+/g, '')
  if (op === 'buy' || op === 'sell') return true
  const t = rawNumericOrderKind(o)
  if (t === 0 || t === 1) return true
  return false
}

/** Count open market positions from the WebSocket `positions` topic snapshot. */
export function parseFxsocketOpenPositionCount(data: unknown): number {
  if (!Array.isArray(data)) return 0
  return data.filter(isFxsocketMarketPositionRow).length
}

/** Pending stop/limit rows from normalized MtTrade / OpenedOrders payloads. */
export function isMtTradePendingEntry(trade: { type?: string | null }): boolean {
  const type = String(trade.type ?? '').toLowerCase()
  return type.includes('limit') || type.includes('stop')
}

export function countOpenMarketPositionsByBroker(
  trades: Array<{ broker_id: string; status?: string; type?: string | null }>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of trades) {
    if (t.status !== 'open') continue
    if (isMtTradePendingEntry(t)) continue
    out[t.broker_id] = (out[t.broker_id] ?? 0) + 1
  }
  return out
}
