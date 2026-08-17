import { isPartialTpTriggered } from './partialTpMonitor'
import { signalPipPrice } from './signalPip'

/** Keep snapshot helpers in sync with supabase/functions/_shared/autoManagement.ts */

export const BREAKEVEN_OFFSET_PIPS_DEFAULT = 3

export type AutoBeMode = 'pips' | 'rr' | 'money' | 'tp_hit'
export type AutoBeType = 'sl_only' | 'sl_and_close_half'

export interface AutoBeConfig {
  mode: AutoBeMode
  triggerValue: number
  tpIndex: number
  beType: AutoBeType
  offsetPips: number
}

export interface AutoBeTriggerInput {
  mode: AutoBeMode
  triggerValue: number
  tpIndex: number
  isBuy: boolean
  entryPrice: number
  riskSl: number | null
  bid: number
  ask: number
  pipPrice: number
  pipValuePerLot: number
  partialTpFiredIndices: number[]
  partialTpTriggers: Array<{ tpIdx: number; triggerPrice: number }>
  brokerTp: number | null
}

function roundPrice(v: number, digits: number): number {
  if (!Number.isFinite(v)) return v
  return Number(v.toFixed(digits))
}

function positiveNum(v: number, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Pips beyond entry when channel or auto breakeven moves SL (default 3). */
export function resolveBreakevenOffsetPips(manual: {
  breakeven_offset_pips?: number
}): number {
  const raw = manual.breakeven_offset_pips
  if (raw === undefined || raw === null) return BREAKEVEN_OFFSET_PIPS_DEFAULT
  return positiveNum(raw, BREAKEVEN_OFFSET_PIPS_DEFAULT)
}

function defaultDigitsForPip(pip: number): number {
  if (pip >= 0.01) return 2
  if (pip >= 0.001) return 3
  return 5
}

/** Channel breakeven SL from entry + configured offset for a symbol. */
export function breakevenStopLossForSymbol(args: {
  isBuy: boolean
  entryPrice: number
  manual: { breakeven_offset_pips?: number }
  symbol: string
  digits?: number
}): number {
  const pip = signalPipPrice(args.symbol)
  const digits = args.digits ?? defaultDigitsForPip(pip)
  return computeBreakevenStopLoss(
    args.isBuy,
    args.entryPrice,
    resolveBreakevenOffsetPips(args.manual),
    pip,
    digits,
  )
}

/** True when manual settings enable auto move-SL-to-breakeven. */
export function isAutoManagementEnabled(manual: {
  move_sl_to_entry_after_mode?: string
}): boolean {
  const mode = String(manual.move_sl_to_entry_after_mode ?? 'none').toLowerCase()
  return mode !== 'none' && mode !== ''
}

export function normalizeAutoBeConfig(manual: {
  move_sl_to_entry_after_mode?: string
  move_sl_to_entry_after_value?: number
  move_sl_to_entry_tp_index?: number
  move_sl_to_entry_type?: string
  breakeven_offset_pips?: number
}): AutoBeConfig | null {
  const rawMode = String(manual.move_sl_to_entry_after_mode ?? 'none').toLowerCase()
  if (rawMode === 'none' || rawMode === '') return null
  const mode: AutoBeMode =
    rawMode === 'pips' || rawMode === 'rr' || rawMode === 'money' || rawMode === 'tp_hit'
      ? rawMode
      : 'pips'
  const beRaw = String(manual.move_sl_to_entry_type ?? 'sl_only').toLowerCase()
  const beType: AutoBeType = beRaw === 'sl_and_close_half' ? 'sl_and_close_half' : 'sl_only'
  return {
    mode,
    triggerValue: positiveNum(manual.move_sl_to_entry_after_value ?? 0, mode === 'rr' ? 1 : 10),
    tpIndex: Math.max(1, Math.floor(Number(manual.move_sl_to_entry_tp_index ?? 1) || 1)),
    beType,
    offsetPips: resolveBreakevenOffsetPips(manual),
  }
}

/**
 * Absolute price of the configured TP-hit trigger (TP1/TP2/…).
 * Used so Move-SL-on-TP-hit still works when predefined/override TPs leave no
 * partial_tp_legs (e.g. a single "TP: 30 pips" override).
 */
export function resolveAutoBeTpHitTriggerPrice(args: {
  tpIndex: number
  partialTps?: Array<{ tpIdx: number; triggerPrice: number }> | null
  finalTps?: number[] | null
  brokerTp?: number | null
}): number | null {
  const target = Math.max(1, Math.floor(Number(args.tpIndex) || 1))
  const fromPartial = (args.partialTps ?? []).find(p => p.tpIdx === target)
  if (fromPartial && Number.isFinite(fromPartial.triggerPrice) && fromPartial.triggerPrice > 0) {
    return Number(fromPartial.triggerPrice)
  }
  const ladder = (args.finalTps ?? []).filter(n => Number.isFinite(n) && n > 0)
  if (ladder.length > 0) {
    const px = ladder[Math.min(target - 1, ladder.length - 1)]
    if (px != null && Number.isFinite(px) && px > 0) return Number(px)
  }
  // Single-TP / no-partial fallback: broker TP is the only level (common with
  // predefined one-row override). Only safe for TP1 — higher indices must come
  // from the ladder above.
  if (
    target === 1
    && args.brokerTp != null
    && Number.isFinite(args.brokerTp)
    && Number(args.brokerTp) > 0
  ) {
    return Number(args.brokerTp)
  }
  return null
}

/**
 * Prefer an explicit plan price; otherwise rebuild the TP-hit level from
 * predefined pip overrides + entry (needed when broker TP was omitted).
 */
export function resolveAutoBeTpHitTriggerPriceFromManual(args: {
  manual: {
    move_sl_to_entry_after_mode?: string
    move_sl_to_entry_after_value?: number
    move_sl_to_entry_tp_index?: number
    move_sl_to_entry_type?: string
    breakeven_offset_pips?: number
    use_predefined_tp_pips?: boolean
    predefined_tp_pips?: number[]
  }
  entryPrice: number
  isBuy: boolean
  pipSize: number
  partialTps?: Array<{ tpIdx: number; triggerPrice: number }> | null
  brokerTp?: number | null
  plannedTriggerPrice?: number | null
}): number | null {
  if (args.plannedTriggerPrice != null && Number.isFinite(args.plannedTriggerPrice) && args.plannedTriggerPrice > 0) {
    return Number(args.plannedTriggerPrice)
  }
  const cfg = normalizeAutoBeConfig(args.manual)
  if (!cfg || cfg.mode !== 'tp_hit') return null
  let finalTps: number[] = []
  if (
    args.manual.use_predefined_tp_pips === true
    && Array.isArray(args.manual.predefined_tp_pips)
    && Number.isFinite(args.entryPrice)
    && args.entryPrice > 0
    && Number.isFinite(args.pipSize)
    && args.pipSize > 0
  ) {
    finalTps = args.manual.predefined_tp_pips
      .map(Number)
      .filter(n => Number.isFinite(n) && n > 0)
      .map(t => (args.isBuy ? args.entryPrice + t * args.pipSize : args.entryPrice - t * args.pipSize))
  }
  return resolveAutoBeTpHitTriggerPrice({
    tpIndex: cfg.tpIndex,
    partialTps: args.partialTps,
    finalTps,
    brokerTp: args.brokerTp,
  })
}

/** True when triggerValue was snapped as an absolute TP price (not legacy unused pips). */
export function isAutoBeTpHitAbsolutePrice(
  triggerValue: number,
  entryPrice: number,
  isBuy: boolean,
): boolean {
  if (!Number.isFinite(triggerValue) || triggerValue <= 0) return false
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false
  return isBuy ? triggerValue > entryPrice : triggerValue < entryPrice
}

export function pricesNearlyEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const scale = Math.max(1, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= scale * 1e-8 + 1e-8
}

/**
 * Single-trade: when the Move-SL TP-hit level is also the broker takeprofit,
 * the position closes at that price before SL can move. Omit broker TP so the
 * monitor can move SL to breakeven when price reaches the (stored) trigger.
 * Multi-trade keeps per-leg broker TPs (TP1 legs are meant to close).
 */
export function shouldOmitBrokerTpForAutoBeTpHit(args: {
  manual: {
    move_sl_to_entry_after_mode?: string
    move_sl_to_entry_after_value?: number
    move_sl_to_entry_tp_index?: number
    move_sl_to_entry_type?: string
    breakeven_offset_pips?: number
    trade_style?: string
  }
  brokerTp: number | null
  finalTps: number[]
  partialTps?: Array<{ tpIdx: number; triggerPrice: number }> | null
}): boolean {
  if (String(args.manual.trade_style ?? '').toLowerCase() === 'multi') return false
  const cfg = normalizeAutoBeConfig(args.manual)
  if (!cfg || cfg.mode !== 'tp_hit') return false
  if (args.brokerTp == null || !Number.isFinite(args.brokerTp) || args.brokerTp <= 0) return false
  const trigger = resolveAutoBeTpHitTriggerPrice({
    tpIndex: cfg.tpIndex,
    partialTps: args.partialTps,
    finalTps: args.finalTps,
    brokerTp: args.brokerTp,
  })
  if (trigger == null) return false
  return pricesNearlyEqual(trigger, args.brokerTp)
}

/** DB columns to set on trades.insert when auto-management is active. */
export function autoManagementTradeSnapshot(
  manual: {
    move_sl_to_entry_after_mode?: string
    move_sl_to_entry_after_value?: number
    move_sl_to_entry_tp_index?: number
    move_sl_to_entry_type?: string
    breakeven_offset_pips?: number
  },
  entryPrice: number | null | undefined,
  sl: number | null | undefined,
  opts?: { tpHitTriggerPrice?: number | null },
): Record<string, string | number | null> {
  if (!isAutoManagementEnabled(manual)) return {}
  const entry = Number(entryPrice)
  if (!Number.isFinite(entry) || entry <= 0) return {}
  const cfg = normalizeAutoBeConfig(manual)
  if (!cfg) return {}
  const riskSl = sl != null && Number.isFinite(Number(sl)) && Number(sl) > 0 ? Number(sl) : null
  // For tp_hit, persist the absolute TP price so the monitor can fire even when
  // there are no partial_tp_legs (predefined single-TP override) and/or broker TP
  // was omitted to avoid closing the trade at the trigger level.
  let triggerValue = cfg.triggerValue
  if (cfg.mode === 'tp_hit') {
    const abs = opts?.tpHitTriggerPrice
    if (abs != null && Number.isFinite(abs) && abs > 0) triggerValue = Number(abs)
  }
  return {
    auto_be_mode: cfg.mode,
    auto_be_trigger_value: triggerValue,
    auto_be_tp_index: cfg.tpIndex,
    auto_be_type: cfg.beType,
    auto_be_offset_pips: cfg.offsetPips,
    auto_be_risk_sl: riskSl,
    auto_be_applied_at: null,
  }
}

export function computeBreakevenStopLoss(
  isBuy: boolean,
  entryPrice: number,
  offsetPips: number,
  pipPrice: number,
  digits: number,
): number {
  const offset = offsetPips * pipPrice
  const raw = isBuy ? entryPrice + offset : entryPrice - offset
  return roundPrice(raw, digits)
}

/** Prefer live broker SL over shared basket SL stored on the trades row. */
export function resolveSlForBreakevenCheck(
  dbSl: number | null,
  brokerSl: number | null | undefined,
): number | null {
  const live = brokerSl != null ? Number(brokerSl) : NaN
  if (Number.isFinite(live) && live > 0) return live
  if (dbSl != null && Number.isFinite(dbSl) && dbSl > 0) return dbSl
  return null
}

/** Skip when SL is already at or beyond the breakeven level. */
export function isSlAtOrBeyondBreakeven(
  isBuy: boolean,
  currentSl: number | null,
  beSl: number,
  pipPrice: number,
): boolean {
  if (currentSl == null || !Number.isFinite(currentSl) || currentSl <= 0) return false
  const tol = pipPrice * 0.5
  if (isBuy) return currentSl >= beSl - tol
  return currentSl <= beSl + tol
}

/** Clamp breakeven SL/TP to broker min distance from the live quote. */
export function clampBreakevenModifyStops(args: {
  isBuy: boolean
  stoploss: number
  takeprofit: number
  referencePrice: number
  point: number
  digits: number
  stopsLevel: number
  freezeLevel: number
}): { stoploss: number; takeprofit: number } {
  const { isBuy, referencePrice: ref, point, digits, stopsLevel, freezeLevel } = args
  if (!Number.isFinite(ref) || ref <= 0 || point <= 0) {
    return { stoploss: args.stoploss, takeprofit: args.takeprofit }
  }
  const minLevel = Math.max(stopsLevel, freezeLevel)
  const minDist = (minLevel + 2) * point
  if (minDist <= 0) return { stoploss: args.stoploss, takeprofit: args.takeprofit }

  const round = (v: number): number => Number(v.toFixed(Math.max(0, Math.min(8, digits))))
  let stoploss = args.stoploss
  let takeprofit = args.takeprofit

  if (isBuy) {
    if (stoploss > 0 && ref - stoploss < minDist) stoploss = round(ref - minDist)
    if (takeprofit > 0 && takeprofit - ref < minDist) takeprofit = round(ref + minDist)
  } else {
    if (stoploss > 0 && stoploss - ref < minDist) stoploss = round(ref + minDist)
    if (takeprofit > 0 && ref - takeprofit < minDist) takeprofit = round(ref - minDist)
  }

  return { stoploss, takeprofit }
}

export function profitPips(
  isBuy: boolean,
  entryPrice: number,
  favorable: number,
  pipPrice: number,
): number {
  if (!Number.isFinite(pipPrice) || pipPrice <= 0) return 0
  return isBuy
    ? (favorable - entryPrice) / pipPrice
    : (entryPrice - favorable) / pipPrice
}

/** Returns true when the configured trigger condition is satisfied. */
export function isAutoBeTriggerMet(input: AutoBeTriggerInput): boolean {
  const {
    mode,
    triggerValue,
    tpIndex,
    isBuy,
    entryPrice,
    riskSl,
    bid,
    ask,
    pipPrice,
    pipValuePerLot,
    partialTpFiredIndices,
    partialTpTriggers,
    brokerTp,
  } = input
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return false

  const favorable = isBuy ? bid : ask
  if (!Number.isFinite(favorable) || favorable <= 0) return false

  switch (mode) {
    case 'pips':
      return profitPips(isBuy, entryPrice, favorable, pipPrice) >= triggerValue
    case 'rr': {
      if (riskSl == null || !Number.isFinite(riskSl)) return false
      const risk = Math.abs(entryPrice - riskSl)
      if (risk <= 0) return false
      const reward = Math.abs(favorable - entryPrice)
      return reward / risk >= triggerValue
    }
    case 'money': {
      const pips = profitPips(isBuy, entryPrice, favorable, pipPrice)
      const profitMoney = pips * pipValuePerLot
      return profitMoney >= triggerValue
    }
    case 'tp_hit': {
      const target = Math.max(1, Math.floor(tpIndex))
      if (partialTpFiredIndices.includes(target)) return true
      const leg = partialTpTriggers.find(p => p.tpIdx === target)
      if (leg && Number.isFinite(leg.triggerPrice) && leg.triggerPrice > 0) {
        return isPartialTpTriggered(isBuy, leg.triggerPrice, bid, ask)
      }
      // Absolute TP price snapped at open (predefined/override TPs, multi-leg
      // siblings waiting on TP1, or single-TP where broker TP was omitted).
      if (isAutoBeTpHitAbsolutePrice(triggerValue, entryPrice, isBuy)) {
        return isPartialTpTriggered(isBuy, triggerValue, bid, ask)
      }
      if (target === 1 && brokerTp != null && Number.isFinite(brokerTp) && brokerTp > 0) {
        return isPartialTpTriggered(isBuy, brokerTp, bid, ask)
      }
      return false
    }
    default:
      return false
  }
}
