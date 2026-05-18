/** Shared MT order/deal field extraction for trades API + history merge. */

export type RawMtOrder = Record<string, unknown>

export function pickMtField(order: RawMtOrder, ...keys: string[]): unknown {
  for (const k of keys) {
    if (order[k] !== undefined && order[k] !== null) return order[k]
  }
  const ex = order.ex
  if (ex && typeof ex === "object" && !Array.isArray(ex)) {
    const nested = ex as RawMtOrder
    for (const k of keys) {
      if (nested[k] !== undefined && nested[k] !== null) return nested[k]
    }
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
  const direct = numMtField(
    order,
    "lots",
    "Lots",
    "lot",
    "Lot",
    "volumeLots",
    "VolumeLots",
    "volume_lots",
  )
  if (direct != null && direct > 0) return direct

  const volExt = numMtField(order, "volumeExt", "VolumeExt")
  if (volExt != null && volExt > 0) {
    if (volExt >= 1_000_000) return volExt / 100_000_000
    if (volExt >= 10_000) return volExt / 10_000
  }

  const vol = numMtField(
    order,
    "volume",
    "Volume",
    "volumeClosed",
    "VolumeClosed",
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
  const p = numMtField(
    order,
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
  )
  return p
}

export function resolveMtTicket(order: RawMtOrder): number {
  const ticket = Number(pickMtField(order, "ticket", "Ticket", "order", "Order", "deal", "Deal") ?? 0)
  return Number.isFinite(ticket) && ticket > 0 ? ticket : 0
}

/** Merge two raw history rows; prefer non-zero lots and non-zero deal profit. */
export function mergeMtHistoryRow(prev: RawMtOrder, next: RawMtOrder): RawMtOrder {
  const merged: RawMtOrder = { ...prev, ...next }

  const prevLots = resolveMtLots(prev)
  const nextLots = resolveMtLots(next)
  if (nextLots <= 0 && prevLots > 0) {
    for (const k of ["lots", "Lots", "lot", "volume", "Volume", "volumeExt", "VolumeExt"]) {
      if (prev[k] != null) merged[k] = prev[k]
    }
  }

  const prevProfit = resolveMtDealProfit(prev)
  const nextProfit = resolveMtDealProfit(next)
  if ((nextProfit == null || nextProfit === 0) && prevProfit != null && prevProfit !== 0) {
    for (const k of ["profit", "Profit", "dealProfit", "DealProfit", "grossProfit", "GrossProfit"]) {
      if (prev[k] != null) merged[k] = prev[k]
    }
  }

  for (const k of ["swap", "Swap", "commission", "Commission"]) {
    if (merged[k] == null && prev[k] != null) merged[k] = prev[k]
  }

  if (!pickMtField(merged, "closeTime", "CloseTime", "close_time", "timeClose", "TimeClose")) {
    const ct = pickMtField(prev, "closeTime", "CloseTime", "close_time", "timeClose", "TimeClose")
    if (ct) merged.closeTime = ct
  }

  if (!pickMtField(merged, "symbol", "Symbol") && pickMtField(prev, "symbol", "Symbol")) {
    merged.symbol = pickMtField(prev, "symbol", "Symbol")
  }

  return merged
}

export function ingestMtHistoryRows(
  target: Map<number, RawMtOrder>,
  rows: unknown[],
): void {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const o = row as RawMtOrder
    const ticket = resolveMtTicket(o)
    if (ticket <= 0) continue
    const prev = target.get(ticket)
    target.set(ticket, prev ? mergeMtHistoryRow(prev, o) : o)
  }
}
