/**
 * Pip vs absolute-price detection for signal SL/TP levels, plus conversion
 * from pip offsets to broker prices at planning time.
 */

import { signalPipPrice } from './signalPip'

export type PriceUnit = 'price' | 'pips'

const TP_LABEL = '(?:tp|take\\s*profit|target(?:\\s+level)?)'
const SL_LABEL = '(?:sl|s\\/?l|stop\\s*loss|stoploss|risk)'

/** True when a TP clause explicitly ends with / contains a pip unit. */
export function tpClauseHasExplicitPips(message: string): boolean {
  const text = String(message ?? '')
  // TP:30/50/100pips  |  TP: 30 / 50 / 100 pips  |  TP1: 30pips  |  take profit 50 pip
  if (
    new RegExp(
      `\\b${TP_LABEL}\\s*#?\\s*\\d*\\s*[:=\\-]?\\s*[\\d./\\s|&and]+\\s*pips?\\b`,
      'i',
    ).test(text)
  ) {
    return true
  }
  // Glued: 100pips immediately after TP number list without space
  if (new RegExp(`\\b${TP_LABEL}\\s*[:=\\-]?\\s*\\d+(?:\\.\\d+)?(?:\\s*[/|]\\s*\\d+(?:\\.\\d+)?)*pips?\\b`, 'i').test(text)) {
    return true
  }
  return false
}

/** True when an SL clause explicitly uses a pip unit (e.g. SL: 20 pips). */
export function slClauseHasExplicitPips(message: string): boolean {
  const text = String(message ?? '')
  return new RegExp(
    `\\b${SL_LABEL}\\s*[:=\\-]?\\s*\\d+(?:\\.\\d+)?\\s*pips?\\b`,
    'i',
  ).test(text)
}

/**
 * Magnitude heuristic: all TP values look like small offsets vs a market-price ref
 * (entry / zone mid / SL), not absolute quotes on the same scale.
 */
export function looksLikePipOffsetMagnitudes(
  tps: number[],
  ref: number | null | undefined,
): boolean {
  const values = (tps ?? []).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
  if (!values.length) return false
  const maxTp = Math.max(...values)
  if (maxTp >= 500) return false
  const r = Number(ref)
  if (!Number.isFinite(r) || r <= 0) {
    // No ref: still treat very small ladders as pips (typical 10–200 pip TPs).
    return maxTp < 500 && values.every(v => v < 500)
  }
  // Same order of magnitude as ref → absolute prices (e.g. TP 4090 vs entry 4109).
  if (values.some(v => v >= r * 0.5)) return false
  return maxTp < 500 && maxTp < r * 0.05
}

export function entryRefFromParsed(parsed: {
  entry_price?: number | null
  entry_zone_low?: number | null
  entry_zone_high?: number | null
  sl?: number | null
}): number | null {
  const ep = Number(parsed.entry_price)
  if (Number.isFinite(ep) && ep > 0) return ep
  const lo = Number(parsed.entry_zone_low)
  const hi = Number(parsed.entry_zone_high)
  if (Number.isFinite(lo) && lo > 0 && Number.isFinite(hi) && hi > 0) {
    return (lo + hi) / 2
  }
  if (Number.isFinite(lo) && lo > 0) return lo
  if (Number.isFinite(hi) && hi > 0) return hi
  const sl = Number(parsed.sl)
  if (Number.isFinite(sl) && sl > 0) return sl
  return null
}

export function resolveTpUnit(args: {
  message: string
  tps: number[]
  channelTpInPips?: boolean
  ref?: number | null
  explicitFromExtract?: boolean
}): PriceUnit {
  if (args.explicitFromExtract || tpClauseHasExplicitPips(args.message)) return 'pips'
  if (args.channelTpInPips === true) return 'pips'
  if (looksLikePipOffsetMagnitudes(args.tps, args.ref ?? null)) return 'pips'
  return 'price'
}

export function resolveSlUnit(args: {
  message: string
  sl: number | null
  channelSlInPips?: boolean
  ref?: number | null
}): PriceUnit {
  if (slClauseHasExplicitPips(args.message)) return 'pips'
  if (args.channelSlInPips === true) return 'pips'
  const sl = Number(args.sl)
  const r = Number(args.ref)
  if (
    Number.isFinite(sl)
    && sl > 0
    && sl < 500
    && Number.isFinite(r)
    && r > 0
    && sl < r * 0.05
    && sl < r * 0.5
  ) {
    return 'pips'
  }
  return 'price'
}

/** Convert pip-offset levels to absolute prices relative to entry. */
export function convertPipOffsetsToPrices(args: {
  offsets: number[]
  entryAnchor: number
  isBuy: boolean
  pipSize: number
}): number[] {
  const { offsets, entryAnchor, isBuy, pipSize } = args
  if (!Number.isFinite(entryAnchor) || entryAnchor <= 0) return []
  if (!Number.isFinite(pipSize) || pipSize <= 0) return []
  return offsets
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0)
    .map(n => (isBuy ? entryAnchor + n * pipSize : entryAnchor - n * pipSize))
}

export function convertPipOffsetToPrice(args: {
  offset: number
  entryAnchor: number
  isBuy: boolean
  pipSize: number
}): number | null {
  const converted = convertPipOffsetsToPrices({
    offsets: [args.offset],
    entryAnchor: args.entryAnchor,
    isBuy: args.isBuy,
    pipSize: args.pipSize,
  })
  return converted[0] ?? null
}

export function resolvePipSize(args: {
  symbol: string
  brokerPipPrice?: number | null
}): number {
  const broker = Number(args.brokerPipPrice)
  if (Number.isFinite(broker) && broker > 0) return broker
  return signalPipPrice(args.symbol)
}
