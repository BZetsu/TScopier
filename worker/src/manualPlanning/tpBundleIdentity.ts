/**
 * Identity-preserving TP assignment for bundled multi / Single percent-split baskets.
 *
 * A percent-split basket opens one leg per take-profit level. Downstream paths that
 * re-derive TPs from Targets % counts (buildDistributedPerLegTakeProfits and
 * friends) would repaint such a basket wrongly — e.g. 3 legs over 50/30/20
 * re-derives as [TP1, TP1, TP2], dropping TP3. When TP bundling is enabled,
 * these helpers keep each leg on its own level instead.
 *
 * Rules (docs/bundled-single-tp-trade-style.md, D3):
 * - Steady state: a leg that already carries a TP keeps it; a naked leg is
 *   backfilled from its planned TP index (`:tpN` comment / next_tp_index /
 *   Targets % volume), else positionally (leg i ↔ ladder level i).
 * - Explicit reladder: prefer planned index when known; otherwise re-map 1:1 by
 *   current TP order (buy ascending, sell descending).
 */

import { parseOrderCommentTpIndex } from '../tradeComment'
import { isTpLotRowEnabled, resolveTpBucketRows } from './tpBucketDistribution'
import type { ManualTpLot } from './types'
import { isTpBundleEnabled } from './tpBundleRollout'

/** One leg's current take-profit (0 / null / undefined when naked). */
export type BundleLegTp = number | null | undefined

/** Minimal manual-settings view the bundle gate needs. */
export type BundleManualLike = {
  trade_style?: string | null
  range_trading?: boolean | null
} | null | undefined

/** Leg metadata used to recover planned TP identity after parallel OrderSend. */
export type BundleLegIdentity = {
  lot_size?: number | null
  comment?: string | null
  /** 1-based planned TP level persisted on `trades.next_tp_index`. */
  next_tp_index?: number | null
}

/**
 * True when this basket is a bundled (or bundle-eligible) multi basket:
 * TP_BUNDLE_ENABLED, the account is multi style, and range/layering is off
 * (the flag is ignored for range trading — see the design doc non-goals).
 */
export function isBundleBasket(manual: unknown): boolean {
  if (!isTpBundleEnabled()) return false
  const m = (manual ?? {}) as { trade_style?: string | null; range_trading?: boolean | null }
  if (m.trade_style !== 'multi') return false
  if (m.range_trading === true) return false
  return true
}

/**
 * True when open legs should keep per-TP identity (one broker TP per leg),
 * not count-weighted redistrib / worker partial closes:
 * - Single trade style (percent-split broker TPs), or
 * - Bundled multi (`isBundleBasket`).
 * Range/layering baskets are excluded.
 */
export function isTpPercentSplitBasket(manual: unknown): boolean {
  const m = (manual ?? {}) as { trade_style?: string | null; range_trading?: boolean | null }
  if (m.range_trading === true) return false
  if (m.trade_style !== 'multi') return true
  return isBundleBasket(manual)
}

/**
 * Resolve 0-based planned TP indexes for open legs.
 * Priority per leg: order comment `:tpN` → `next_tp_index` → Targets % volume match.
 * Parallel teaser fills scramble `opened_at`, so positional ladder[i] is unsafe alone.
 */
export function resolveBundleLegTpIndexes(args: {
  legs: ReadonlyArray<BundleLegIdentity>
  ladderLength: number
  tpLots?: ManualTpLot[] | null
}): Array<number | null> {
  const n = args.legs.length
  const ladderLen = Math.max(0, Math.floor(args.ladderLength))
  if (n === 0) return []

  const fromComment: Array<number | null> = args.legs.map(leg => {
    const idx = parseOrderCommentTpIndex(leg.comment)
    if (idx != null && (ladderLen <= 0 || idx < ladderLen)) return idx
    return null
  })
  const fromDb: Array<number | null> = args.legs.map(leg => {
    const raw = Number(leg.next_tp_index)
    if (!Number.isFinite(raw) || raw < 1) return null
    const idx = Math.floor(raw) - 1
    if (ladderLen > 0 && idx >= ladderLen) return null
    return idx
  })
  // trades.next_tp_index defaults to 1 for every row — only trust DB indexes when
  // they actually distinguish legs (or there is a single leg).
  const dbDistinct = new Set(fromDb.filter((v): v is number => v != null))
  const trustDb = fromComment.some(v => v != null)
    ? false
    : (n === 1 || dbDistinct.size >= 2)

  const out: Array<number | null> = args.legs.map((_, i) => {
    if (fromComment[i] != null) return fromComment[i]!
    if (trustDb && fromDb[i] != null) return fromDb[i]!
    return null
  })

  if (out.every(v => v != null) || ladderLen <= 0) return out

  const totalLots = args.legs.reduce((sum, leg) => {
    const lots = Number(leg.lot_size)
    return sum + (Number.isFinite(lots) && lots > 0 ? lots : 0)
  }, 0)
  if (!(totalLots > 0)) return out

  const planned = plannedPercentSplitVolumes({
    totalLots,
    ladderLength: ladderLen,
    tpLots: args.tpLots,
  })
  const used = new Set(out.filter((v): v is number => v != null))
  const freeLegs = out.map((v, i) => (v == null ? i : -1)).filter(i => i >= 0)
  const freeBuckets = planned
    .map((vol, i) => ({ i, vol }))
    .filter(b => b.vol > 0 && !used.has(b.i))

  for (const bucket of freeBuckets) {
    if (!freeLegs.length) break
    let bestPos = 0
    let bestDiff = Infinity
    for (let p = 0; p < freeLegs.length; p++) {
      const legIdx = freeLegs[p]!
      const lots = Number(args.legs[legIdx]?.lot_size)
      if (!(Number.isFinite(lots) && lots > 0)) continue
      const diff = Math.abs(lots - bucket.vol)
      if (diff < bestDiff) {
        bestDiff = diff
        bestPos = p
      }
    }
    const legIdx = freeLegs.splice(bestPos, 1)[0]
    if (legIdx == null) continue
    out[legIdx] = bucket.i
    used.add(bucket.i)
  }

  return out
}

/** Planned lot per ladder index from Targets % (raw, before lot-step remainder). */
export function plannedPercentSplitVolumes(args: {
  totalLots: number
  ladderLength: number
  tpLots?: ManualTpLot[] | null
}): number[] {
  const len = Math.max(0, Math.floor(args.ladderLength))
  if (len === 0 || !(args.totalLots > 0)) return []
  const dummyLadder = Array.from({ length: len }, (_, i) => i + 1)
  const { bucketRows } = resolveTpBucketRows(dummyLadder, args.tpLots)
  if (!bucketRows.some(r => r.percent > 0) && (args.tpLots?.length ?? 0) > 0) {
    // Teaser path may have more percent rows than signal TPs later; prefer tp_lots length.
    const lots = args.tpLots ?? []
    const vols: number[] = []
    for (let i = 0; i < Math.min(len, lots.length); i++) {
      const row = lots[i]
      if (!row || !isTpLotRowEnabled(row)) {
        vols.push(0)
        continue
      }
      const pct = Number(row.percent)
      vols.push(Number.isFinite(pct) && pct > 0 ? (args.totalLots * Math.min(100, pct)) / 100 : 0)
    }
    while (vols.length < len) vols.push(0)
    return vols
  }
  return bucketRows.map(r => (r.percent > 0 ? (args.totalLots * r.percent) / 100 : 0))
}

/**
 * Reladder map for bundled baskets: leg id → new TP, assigned 1:1 by current
 * TP order (buy ascending, sell descending). Drop-in replacement for the
 * count-weighted buildEntryQualityTakeProfitMap when the bundle flag is on.
 */
export function bundleTpOrderMap(args: {
  legs: ReadonlyArray<{ id: string; tp: BundleLegTp } & BundleLegIdentity>
  ladder: readonly number[]
  isBuy: boolean
  tpLots?: ManualTpLot[] | null
}): Map<string, number> {
  const ladder = args.ladder.filter(t => typeof t === 'number' && Number.isFinite(t) && t > 0)
  const legTpIndexes = resolveBundleLegTpIndexes({
    legs: args.legs,
    ladderLength: ladder.length,
    tpLots: args.tpLots,
  })
  const tps = remapBundleLegTpsByTpOrder({
    legs: args.legs.map(l => l.tp),
    ladder,
    isBuy: args.isBuy,
    legTpIndexes,
  })
  const out = new Map<string, number>()
  args.legs.forEach((leg, i) => {
    const tp = tps[i]
    if (typeof tp === 'number' && tp > 0) out.set(leg.id, tp)
  })
  return out
}

/**
 * Steady-state TPs, one per leg: own TP when it has one, otherwise the planned
 * ladder level (via legTpIndexes), else positional ladder[i], falling back to
 * the deepest level when the ladder is shorter than the leg list.
 */
export function bundleSteadyLegTps(args: {
  currentTps: readonly BundleLegTp[]
  ladder: readonly number[]
  legTpIndexes?: ReadonlyArray<number | null | undefined>
}): number[] {
  const ladder = args.ladder.filter(t => typeof t === 'number' && Number.isFinite(t) && t > 0)
  const deepest = ladder[ladder.length - 1] ?? 0
  return args.currentTps.map((tp, i) => {
    const own = Number(tp)
    if (Number.isFinite(own) && own > 0) return own
    const planned = args.legTpIndexes?.[i]
    if (typeof planned === 'number' && Number.isFinite(planned) && planned >= 0) {
      return ladder[Math.floor(planned)] ?? deepest
    }
    return ladder[i] ?? deepest
  })
}

/**
 * Explicit reladder: when planned indexes are known, map each leg to that
 * ladder level. Otherwise sort by current TP in trade direction (buy: nearest
 * = lowest price first; sell: nearest = highest price first) and assign the
 * new ladder's levels 1:1 in that order. Naked legs without an index sort as
 * deepest. Legs beyond the ladder keep their own TP.
 */
export function remapBundleLegTpsByTpOrder(args: {
  legs: readonly BundleLegTp[]
  ladder: readonly number[]
  isBuy: boolean
  legTpIndexes?: ReadonlyArray<number | null | undefined>
}): number[] {
  const ladder = args.ladder.filter(t => typeof t === 'number' && Number.isFinite(t) && t > 0)
  const n = args.legs.length
  if (n === 0) return []

  const own = args.legs.map(tp => Number(tp))
  const valid = own.map(v => Number.isFinite(v) && v > 0)
  if (!ladder.length) return own.map(v => (Number.isFinite(v) && v > 0 ? v : 0))

  const indexes = args.legTpIndexes
  const hasPlanned = indexes != null && indexes.some(v => typeof v === 'number' && v >= 0)
  if (hasPlanned) {
    return own.map((v, i) => {
      const idx = indexes![i]
      if (typeof idx === 'number' && Number.isFinite(idx) && idx >= 0) {
        return ladder[Math.floor(idx)] ?? ladder[ladder.length - 1]!
      }
      return valid[i] ? v : (ladder[ladder.length - 1]!)
    })
  }

  const order = [...Array(n).keys()].sort((a, b) => {
    const at = valid[a] ? own[a]! : (args.isBuy ? Infinity : -Infinity)
    const bt = valid[b] ? own[b]! : (args.isBuy ? Infinity : -Infinity)
    return args.isBuy ? at - bt : bt - at
  })

  const out = new Array<number>(n).fill(0)
  for (let k = 0; k < order.length; k++) {
    const legIdx = order[k]!
    if (k < ladder.length) {
      out[legIdx] = ladder[k]!
    } else {
      out[legIdx] = valid[legIdx] ? own[legIdx]! : (ladder[ladder.length - 1]!)
    }
  }
  return out
}

/**
 * Steady-state target rows (SL preserved from the computed targets) with
 * bundled TPs: own TP when present, planned/positional ladder backfill when naked.
 */
export function bundleSteadyTargetRows<T extends { stoploss: number }>(args: {
  rows: readonly T[]
  currentTps: readonly BundleLegTp[]
  ladder: readonly number[]
  legTpIndexes?: ReadonlyArray<number | null | undefined>
}): Array<T & { takeprofit: number }> {
  const tps = bundleSteadyLegTps({
    currentTps: args.currentTps,
    ladder: args.ladder,
    legTpIndexes: args.legTpIndexes,
  })
  return args.rows.map((row, i) => ({ ...row, takeprofit: tps[i] ?? 0 }))
}
