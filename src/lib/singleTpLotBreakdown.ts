/**
 * Preview how a Single Entry fixed lot opens as separate broker trades
 * (one per Targets % TP). Mirrors worker planTpPercentSplitOrders sizing.
 */

export type SingleTpTarget = `tp${number}` | 'farthest'

export type SingleTpLotSlice = {
  tpLabel: string
  /** 1-based TP index (TP1 → 1). */
  tpIdx: number
  lots: number
}

export type SingleTpLotBreakdownArgs = {
  manualLot: number
  /** @deprecated Unused — each enabled TP gets its own trade. Kept for call-site compat. */
  singleTpTarget?: SingleTpTarget | string | null
  /** TP distribution rows; only enabled rows with a usable percent participate. */
  tpLots: Array<{ label?: string; percent?: number; enabled?: boolean }>
  minLot?: number
  lotStep?: number
}

function formatLot(lots: number): number {
  return Number(lots.toFixed(8))
}

function defaultLabel(idx: number, label?: string): string {
  const trimmed = String(label ?? '').trim()
  if (trimmed) return trimmed
  return `TP${idx + 1}`
}

/**
 * Build ordered lot slices — one open trade per enabled Targets % row.
 * Floor each bucket to lotStep; sub-min and remainder go to the farthest bucket.
 */
export function computeSingleTpLotBreakdown(args: SingleTpLotBreakdownArgs): SingleTpLotSlice[] {
  const minLot = args.minLot ?? 0.01
  const lotStep = args.lotStep ?? 0.01
  const manualLot = Number(args.manualLot)
  if (!Number.isFinite(manualLot) || manualLot <= 0) return []

  const enabled = (args.tpLots ?? []).filter(r => r?.enabled !== false)
  if (!enabled.length) {
    return [{ tpLabel: 'TP1', tpIdx: 1, lots: formatLot(manualLot) }]
  }

  const labels = enabled.map((r, i) => defaultLabel(i, r.label))
  const buckets: Array<{ idx: number; label: string; rawLots: number }> = []
  for (let i = 0; i < enabled.length; i++) {
    const pct = Number(enabled[i]?.percent)
    if (!(Number.isFinite(pct) && pct > 0)) continue
    buckets.push({
      idx: i,
      label: labels[i] ?? `TP${i + 1}`,
      rawLots: (manualLot * Math.min(100, pct)) / 100,
    })
  }

  if (buckets.length === 0) {
    return [{ tpLabel: labels[0] ?? 'TP1', tpIdx: 1, lots: formatLot(manualLot) }]
  }
  if (buckets.length === 1) {
    return [{
      tpLabel: buckets[0]!.label,
      tpIdx: buckets[0]!.idx + 1,
      lots: formatLot(manualLot),
    }]
  }

  const toUnits = (lots: number): number => Math.floor((lots / lotStep) + 1e-9)
  const totalUnits = toUnits(manualLot)
  const minUnits = Math.max(1, toUnits(minLot))

  const planned = buckets.map(b => ({ ...b, units: Math.max(0, toUnits(b.rawLots)) }))
  const kept: typeof planned = []
  let rescuedUnits = 0
  for (const b of planned) {
    if (b.units > 0 && b.units >= minUnits) kept.push(b)
    else rescuedUnits += b.units
  }
  if (kept.length === 0) {
    return [{ tpLabel: labels[0] ?? 'TP1', tpIdx: 1, lots: formatLot(manualLot) }]
  }
  if (kept.length === 1) {
    return [{
      tpLabel: kept[0]!.label,
      tpIdx: kept[0]!.idx + 1,
      lots: formatLot(manualLot),
    }]
  }

  const farthest = kept[kept.length - 1]!
  let floorSum = 0
  for (const b of kept) floorSum += b.units
  const remainderUnits = totalUnits - floorSum - rescuedUnits
  if (remainderUnits < 0) {
    return [{ tpLabel: labels[0] ?? 'TP1', tpIdx: 1, lots: formatLot(manualLot) }]
  }
  const farthestUnits = farthest.units + rescuedUnits + remainderUnits
  if (farthestUnits < minUnits) {
    return [{
      tpLabel: farthest.label,
      tpIdx: farthest.idx + 1,
      lots: formatLot(manualLot),
    }]
  }

  const slices: SingleTpLotSlice[] = []
  for (const b of kept) {
    const units = b === farthest ? farthestUnits : b.units
    if (units < minUnits) continue
    const lots = formatLot(Math.round(units * lotStep * 1e8) / 1e8)
    if (!(lots > 0)) continue
    slices.push({ tpLabel: b.label, tpIdx: b.idx + 1, lots })
  }
  return slices.length ? slices : [{ tpLabel: labels[0] ?? 'TP1', tpIdx: 1, lots: formatLot(manualLot) }]
}

export type SingleTpPartialShortfall = {
  /** Labels of TP levels that should open but cannot at the current lot. */
  dropped: string[]
}

/**
 * Levels whose share floors below the broker minimum and cannot open as a
 * separate trade (their volume is rescued into the farthest TP).
 */
export function computeSingleTpPartialShortfall(
  args: SingleTpLotBreakdownArgs,
): SingleTpPartialShortfall | null {
  const enabled = (args.tpLots ?? []).filter(r => r?.enabled !== false)
  if (enabled.length < 2) return null

  const labels = enabled.map((r, i) => defaultLabel(i, r.label))
  const slices = computeSingleTpLotBreakdown(args)
  if (!slices.length) return null
  const scheduledIdx = new Set(slices.map(s => s.tpIdx))

  const dropped: string[] = []
  for (let i = 0; i < enabled.length; i++) {
    const pct = Number(enabled[i]?.percent)
    if (!(Number.isFinite(pct) && pct > 0)) continue
    if (!scheduledIdx.has(i + 1)) dropped.push(labels[i] ?? `TP${i + 1}`)
  }
  return dropped.length ? { dropped } : null
}
