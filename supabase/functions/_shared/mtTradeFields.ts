/** Shared MT order/deal field extraction for trades API + history merge. */

export type RawMtOrder = Record<string, unknown>

/** Nested protobuf / REST objects that carry real lots & profit when top-level fields are 0. */
const MT_NESTED_OBJECTS = [
  "dealInternalOut",
  "DealInternalOut",
  "dealInternalIn",
  "DealInternalIn",
  "orderInternal",
  "OrderInternal",
  "ex",
  "Ex",
  "deal",
  "Deal",
  "position",
  "Position",
  "result",
  "Result",
] as const

function isPlainObject(v: unknown): v is RawMtOrder {
  return v != null && typeof v === "object" && !Array.isArray(v)
}

function scalarValue(v: unknown): boolean {
  return v !== null && v !== undefined && typeof v !== "object"
}

/**
 * Hoist nested deal/order fields to the top level. MT5 REST often returns
 * `volume: 0` and `profit: 0` on the parent while `dealInternalOut` has the
 * closed deal profit and lots (see metatraderapi.dev Order schema).
 */
export function flattenMtOrder(row: unknown): RawMtOrder {
  if (!isPlainObject(row)) return {}
  const flat: RawMtOrder = { ...row }

  const absorb = (src: RawMtOrder) => {
    for (const [k, v] of Object.entries(src)) {
      if (!scalarValue(v)) continue
      const cur = flat[k]
      if (cur === undefined || cur === null || cur === "") {
        flat[k] = v
        continue
      }
      // Top-level numeric zeros are often placeholders; prefer nested non-zero.
      if (typeof cur === "number" && cur === 0 && typeof v === "number" && v !== 0) {
        flat[k] = v
      }
    }
  }

  if (isPlainObject(flat.result)) absorb(flat.result as RawMtOrder)

  for (const key of MT_NESTED_OBJECTS) {
    const nested = flat[key]
    if (isPlainObject(nested)) absorb(nested)
  }

  const ticket = Number(flat.ticket ?? flat.Ticket ?? 0)
  if (!(ticket > 0)) {
    const tn = Number(
      flat.ticketNumber ?? flat.TicketNumber ?? flat.dealTicket ?? flat.DealTicket ?? 0,
    )
    if (tn > 0) flat.ticket = tn
  }

  return flat
}

export function pickMtField(order: RawMtOrder, ...keys: string[]): unknown {
  const flat = flattenMtOrder(order)
  for (const k of keys) {
    if (flat[k] !== undefined && flat[k] !== null) return flat[k]
  }
  return undefined
}

export function numMtField(order: RawMtOrder, ...keys: string[]): number | null {
  const v = pickMtField(order, ...keys)
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Convert MT volume / lots fields to standard lots (0.01 = 0.01 lot). */
export function resolveMtLots(order: RawMtOrder): number {
  const flat = flattenMtOrder(order)

  const direct = numMtField(
    flat,
    "lots",
    "Lots",
    "lot",
    "Lot",
    "volumeLots",
    "VolumeLots",
    "volume_lots",
    "closeLots",
    "CloseLots",
    "requestLots",
    "RequestLots",
  )
  if (direct != null && direct > 0) return direct

  const volExt = numMtField(flat, "volumeExt", "VolumeExt")
  if (volExt != null && volExt > 0) {
    if (volExt >= 1_000_000) return volExt / 100_000_000
    if (volExt >= 10_000) return volExt / 10_000
  }

  const vol = numMtField(
    flat,
    "volume",
    "Volume",
    "volumeClosed",
    "VolumeClosed",
    "closeVolume",
    "CloseVolume",
    "requestVolume",
    "RequestVolume",
    "dealVolume",
    "DealVolume",
  )
  if (vol == null || vol <= 0) return 0

  // MT5 integer volume: 100 = 0.01 lot, 10_000 = 1.0 lot (1/10000 lot units).
  if (vol >= 100 && Number.isInteger(vol)) return vol / 10_000

  return vol
}

/** Deal profit from MT row (terminal profit column). */
export function resolveMtDealProfit(order: RawMtOrder): number | null {
  const flat = flattenMtOrder(order)

  const p = numMtField(
    flat,
    "profit",
    "Profit",
    "dealProfit",
    "DealProfit",
    "grossProfit",
    "GrossProfit",
    "closeProfit",
    "CloseProfit",
    "realizedProfit",
    "RealizedProfit",
    "freeProfit",
    "FreeProfit",
  )
  if (p != null && p !== 0) return p

  // Closed P/L is usually on the OUT deal; IN deal profit is often 0.
  for (const key of ["dealInternalOut", "DealInternalOut"] as const) {
    const out = order[key]
    if (!isPlainObject(out)) continue
    const op = numMtField(out, "profit", "Profit", "freeProfit", "FreeProfit")
    if (op != null) return op
  }

  return p
}

export function resolveMtTicket(order: RawMtOrder): number {
  const flat = flattenMtOrder(order)
  const ticket = Number(
    pickMtField(flat, "ticket", "Ticket", "order", "Order", "deal", "Deal") ?? 0,
  )
  return Number.isFinite(ticket) && ticket > 0 ? ticket : 0
}

function closeTimeKey(order: RawMtOrder): string {
  const ct = pickMtField(
    order,
    "closeTime",
    "CloseTime",
    "close_time",
    "timeClose",
    "TimeClose",
    "doneTime",
    "DoneTime",
    "historyTime",
    "HistoryTime",
  )
  return ct != null ? String(ct) : ""
}

export function historyRowKey(order: RawMtOrder): string {
  const ticket = resolveMtTicket(order)
  if (ticket <= 0) return ""
  const ct = closeTimeKey(order)
  return ct ? `${ticket}:${ct}` : String(ticket)
}

/** Merge two raw history rows; prefer non-zero lots and non-zero deal profit. */
export function mergeMtHistoryRow(prev: RawMtOrder, next: RawMtOrder): RawMtOrder {
  const prevFlat = flattenMtOrder(prev)
  const nextFlat = flattenMtOrder(next)
  const merged: RawMtOrder = { ...prevFlat, ...nextFlat }

  const prevLots = resolveMtLots(prevFlat)
  const nextLots = resolveMtLots(nextFlat)
  if (nextLots <= 0 && prevLots > 0) {
    for (const k of ["lots", "Lots", "lot", "volume", "Volume", "volumeExt", "VolumeExt", "closeLots", "CloseLots"]) {
      if (prevFlat[k] != null) merged[k] = prevFlat[k]
    }
  }

  const prevProfit = resolveMtDealProfit(prevFlat)
  const nextProfit = resolveMtDealProfit(nextFlat)
  if ((nextProfit == null || nextProfit === 0) && prevProfit != null && prevProfit !== 0) {
    for (const k of ["profit", "Profit", "dealProfit", "DealProfit", "grossProfit", "GrossProfit"]) {
      if (prevFlat[k] != null) merged[k] = prevFlat[k]
    }
    for (const key of ["dealInternalOut", "DealInternalOut"] as const) {
      if (isPlainObject(prevFlat[key])) merged[key] = prevFlat[key]
    }
  }

  for (const k of ["swap", "Swap", "commission", "Commission", "fee", "Fee"]) {
    if (merged[k] == null && prevFlat[k] != null) merged[k] = prevFlat[k]
  }

  if (!pickMtField(merged, "closeTime", "CloseTime", "close_time", "timeClose", "TimeClose")) {
    const ct = pickMtField(prevFlat, "closeTime", "CloseTime", "close_time", "timeClose", "TimeClose")
    if (ct) merged.closeTime = ct
  }

  if (!pickMtField(merged, "symbol", "Symbol") && pickMtField(prevFlat, "symbol", "Symbol")) {
    merged.symbol = pickMtField(prevFlat, "symbol", "Symbol")
  }

  return merged
}

export function ingestMtHistoryRows(
  target: Map<string, RawMtOrder>,
  rows: unknown[],
): void {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const o = flattenMtOrder(row)
    const key = historyRowKey(o)
    if (!key) continue
    const prev = target.get(key)
    target.set(key, prev ? mergeMtHistoryRow(prev, o) : o)
  }
}
