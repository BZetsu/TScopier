import type {
  LayeringMode,
  LayeringPlanSnapshot,
  LayerPlanAnchorSource,
  ManualSettings,
} from './types'
import { resolveLayeringModeRolloutDecision } from './layeringModeRollout'

export const LAYERING_MODES = ['legacy', 'static', 'dynamic'] as const
export const DEFAULT_LAYERING_MODE: LayeringMode = 'legacy'
export const MIN_LAYER_COUNT = 1
export const MAX_LAYER_COUNT = 20
export const DEFAULT_STATIC_LAYER_COUNT = 5
export const DEFAULT_DYNAMIC_MAX_LAYERS = 5
export const DEFAULT_DYNAMIC_STEP_PIPS = 3
export const LAYERING_PLAN_SCHEMA_VERSION = 1
export const LAYERING_PLAN_CALCULATOR_VERSION = 'layering-v1'

const ANCHOR_SOURCES = new Set<LayerPlanAnchorSource>(['signal', 'quote', 'fill', 'unknown'])
export const MIN_LAYER_PLAN_ID_LENGTH = 8
export const MAX_LAYER_PLAN_ID_LENGTH = 128
const LAYER_PLAN_ID_RE = /^[A-Za-z0-9_-]+$/
const MAX_LAYER_PLAN_DECIMAL_PLACES = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function looseFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeInteger(value: unknown, fallback: number): number {
  const n = looseFiniteNumber(value)
  if (n == null) return fallback
  return Math.max(MIN_LAYER_COUNT, Math.min(MAX_LAYER_COUNT, Math.floor(n)))
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const n = looseFiniteNumber(value)
  if (n == null || n <= 0) return fallback
  return n
}

function strictFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strictLayerCount(value: unknown): number | null {
  const n = strictFiniteNumber(value)
  if (n == null || !Number.isInteger(n) || n < MIN_LAYER_COUNT || n > MAX_LAYER_COUNT) return null
  return n
}

function strictNonNegativeNumber(value: unknown): number | null {
  const n = strictFiniteNumber(value)
  return n != null && n >= 0 ? n : null
}

function strictPositiveNumber(value: unknown): number | null {
  const n = strictFiniteNumber(value)
  return n != null && n > 0 ? n : null
}

function strictString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function strictNumberArray(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null
  const out: number[] = []
  for (const item of value) {
    const n = strictFiniteNumber(item)
    if (n == null) return null
    out.push(n)
  }
  return Object.freeze(out)
}

function strictPositiveNumberArray(value: unknown): readonly number[] | null {
  const arr = strictNumberArray(value)
  if (arr == null || arr.some(v => v <= 0)) return null
  return arr
}

function uniqueNumbers(values: readonly number[]): boolean {
  return new Set(values.map(v => String(v))).size === values.length
}

function pricesOrdered(side: 'buy' | 'sell', prices: readonly number[]): boolean {
  for (let idx = 1; idx < prices.length; idx++) {
    if (side === 'buy' && prices[idx]! >= prices[idx - 1]!) return false
    if (side === 'sell' && prices[idx]! <= prices[idx - 1]!) return false
  }
  return true
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY
  const text = value.toString().toLowerCase()
  const [mantissa, expText] = text.split('e')
  const exponent = expText == null ? 0 : Number(expText)
  const decimals = (mantissa?.split('.')[1]?.length ?? 0) - exponent
  return Math.max(0, decimals)
}

function decimalScalePlaces(values: readonly number[]): number | null {
  const places = Math.max(...values.map(decimalPlaces))
  if (!Number.isFinite(places) || places > MAX_LAYER_PLAN_DECIMAL_PLACES) return null
  return places
}

function toDecimalUnits(value: number, places: number): number | null {
  if (!Number.isFinite(value)) return null
  const text = value.toFixed(places)
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [whole, fraction = ''] = unsigned.split('.')
  const padded = fraction.padEnd(places, '0')
  const unitsText = `${whole}${padded}`.replace(/^0+(?=\d)/, '')
  const units = Number(unitsText || '0')
  if (!Number.isSafeInteger(units)) return null
  return negative ? -units : units
}

function validatePlanLotTotals(
  plannedTotalLot: number | null,
  allocatedTotalLot: number | null,
  unallocatedLot: number | null,
  lots: readonly number[] | null,
): boolean {
  if (plannedTotalLot == null || allocatedTotalLot == null || unallocatedLot == null || lots == null) return true
  const values = [plannedTotalLot, allocatedTotalLot, unallocatedLot, ...lots]
  const places = decimalScalePlaces(values)
  if (places == null) return false
  const plannedUnits = toDecimalUnits(plannedTotalLot, places)
  const allocatedUnits = toDecimalUnits(allocatedTotalLot, places)
  const unallocatedUnits = toDecimalUnits(unallocatedLot, places)
  const lotUnits = lots.map(lot => toDecimalUnits(lot, places))
  if (plannedUnits == null || allocatedUnits == null || unallocatedUnits == null || lotUnits.some(v => v == null)) return false
  const lotSumUnits = (lotUnits as number[]).reduce((sum, units) => sum + units, 0)
  return allocatedUnits === lotSumUnits
    && allocatedUnits <= plannedUnits
    && unallocatedUnits === plannedUnits - allocatedUnits
    && unallocatedUnits >= 0
}

export function isValidLayerPlanId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.trim() !== value) return false
  if (value.length < MIN_LAYER_PLAN_ID_LENGTH || value.length > MAX_LAYER_PLAN_ID_LENGTH) return false
  return LAYER_PLAN_ID_RE.test(value)
}

function strictTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString() === value ? value : null
}

export function resolveLayeringMode(settings: Pick<ManualSettings, 'layering_mode'> | unknown): LayeringMode {
  const raw = isRecord(settings) ? settings.layering_mode : undefined
  return raw === 'static' || raw === 'dynamic' || raw === 'legacy' ? raw : DEFAULT_LAYERING_MODE
}

export function isLegacyLayeringMode(settings: Pick<ManualSettings, 'layering_mode'> | unknown): boolean {
  return resolveLayeringMode(settings) === 'legacy'
}

export function isStaticLayeringMode(settings: Pick<ManualSettings, 'layering_mode'> | unknown): boolean {
  return resolveLayeringMode(settings) === 'static'
}

export function isDynamicLayeringMode(settings: Pick<ManualSettings, 'layering_mode'> | unknown): boolean {
  return resolveLayeringMode(settings) === 'dynamic'
}

export function layeringModesExecutionEnabled(): boolean {
  return resolveLayeringModeRolloutDecision({
    mode: 'static',
    brokerAccountId: '__capability_probe__',
  }).prepareAllowed
    || resolveLayeringModeRolloutDecision({
      mode: 'dynamic',
      brokerAccountId: '__capability_probe__',
    }).prepareAllowed
}

export function normalizeLayeringModeSettings(raw: Record<string, unknown>): Pick<
  ManualSettings,
  'layering_mode' | 'static_layer_count' | 'dynamic_step_pips' | 'dynamic_max_layers'
> {
  const rangeStepFallback = normalizePositiveNumber(raw.range_step_pips, DEFAULT_DYNAMIC_STEP_PIPS)
  return {
    layering_mode: resolveLayeringMode(raw),
    static_layer_count: normalizeInteger(raw.static_layer_count, DEFAULT_STATIC_LAYER_COUNT),
    dynamic_step_pips: normalizePositiveNumber(raw.dynamic_step_pips, rangeStepFallback),
    dynamic_max_layers: normalizeInteger(raw.dynamic_max_layers, DEFAULT_DYNAMIC_MAX_LAYERS),
  }
}

export function assertLayeringModeExecutionSupported(settings: ManualSettings): { ok: true } | { ok: false; reason: string } {
  const mode = resolveLayeringMode(settings)
  if (mode === 'legacy') return { ok: true }
  const decision = resolveLayeringModeRolloutDecision({ mode })
  if (decision.prepareAllowed) return { ok: true }
  return { ok: false, reason: `layering_mode_${mode}_${decision.reason}` }
}

export function parseLayeringPlanSnapshot(raw: unknown): LayeringPlanSnapshot | null {
  try {
    if (raw == null) {
      return {
        schemaVersion: 0,
        calculatorVersion: 'legacy',
        planId: 'legacy',
        mode: 'legacy',
        signalId: '',
        brokerAccountId: '',
        basketKey: null,
        symbol: '',
        side: 'buy',
        originalRangeLow: null,
        originalRangeHigh: null,
        anchorPrice: null,
        executableAnchorPrice: null,
        anchorSource: 'unknown',
        configuredStaticLayerCount: null,
        configuredDynamicStepPips: null,
        configuredDynamicMaxLayers: null,
        optimizationStrategy: null,
        theoreticalLayerCount: null,
        effectiveStepPips: null,
        requestedLayerPercent: null,
        effectiveLayerPercent: null,
        allocationPercentTotal: null,
        requestedLayerCount: null,
        plannedLayerCount: null,
        plannedTotalLot: null,
        allocatedTotalLot: null,
        unallocatedLot: null,
        fundedPrices: null,
        lots: null,
        reasons: Object.freeze([]),
        createdAt: new Date(0).toISOString(),
        lockedAt: null,
      }
    }
    if (!isRecord(raw)) return null
    const row = raw
    const rawMode = row.mode
    if (rawMode !== 'static' && rawMode !== 'dynamic' && rawMode !== 'legacy') return null
    const mode: LayeringMode = rawMode
    const rawSide = row.side == null && mode === 'legacy' ? 'buy' : row.side
    if (rawSide !== 'buy' && rawSide !== 'sell') return null
    const side = rawSide
    const schemaVersion = row.schemaVersion == null && mode === 'legacy'
      ? 0
      : strictFiniteNumber(row.schemaVersion)
    if (schemaVersion == null || !Number.isInteger(schemaVersion)) return null
    if (mode === 'legacy') {
      if (schemaVersion !== 0 && schemaVersion !== LAYERING_PLAN_SCHEMA_VERSION) return null
    } else if (schemaVersion !== LAYERING_PLAN_SCHEMA_VERSION) {
      return null
    }
    const calculatorVersion = row.calculatorVersion == null && mode === 'legacy'
      ? 'legacy'
      : strictString(row.calculatorVersion)
    if (calculatorVersion == null) return null
    if (mode !== 'legacy' && calculatorVersion !== LAYERING_PLAN_CALCULATOR_VERSION) return null
    const anchorSource = ANCHOR_SOURCES.has(row.anchorSource as LayerPlanAnchorSource)
      ? row.anchorSource as LayerPlanAnchorSource
      : null
    if (anchorSource == null) return null
    const planId = isValidLayerPlanId(row.planId) ? row.planId : null
    if (planId == null && mode !== 'legacy') return null
    const plannedLayerCount = row.plannedLayerCount == null ? null : strictLayerCount(row.plannedLayerCount)
    if (row.plannedLayerCount != null && plannedLayerCount == null) return null
    const requestedLayerCount = row.requestedLayerCount == null ? null : strictLayerCount(row.requestedLayerCount)
    if (row.requestedLayerCount != null && requestedLayerCount == null) return null
    const plannedTotalLot = row.plannedTotalLot == null ? null : strictNonNegativeNumber(row.plannedTotalLot)
    if (row.plannedTotalLot != null && plannedTotalLot == null) return null
    const allocatedTotalLot = row.allocatedTotalLot == null ? null : strictNonNegativeNumber(row.allocatedTotalLot)
    if (row.allocatedTotalLot != null && allocatedTotalLot == null) return null
    const unallocatedLot = row.unallocatedLot == null ? null : strictNonNegativeNumber(row.unallocatedLot)
    if (row.unallocatedLot != null && unallocatedLot == null) return null
    if (allocatedTotalLot != null && plannedTotalLot != null && allocatedTotalLot > plannedTotalLot) return null
    const configuredStaticLayerCount = row.configuredStaticLayerCount == null ? null : strictLayerCount(row.configuredStaticLayerCount)
    if (row.configuredStaticLayerCount != null && configuredStaticLayerCount == null) return null
    const configuredDynamicStepPips = row.configuredDynamicStepPips == null ? null : strictPositiveNumber(row.configuredDynamicStepPips)
    if (row.configuredDynamicStepPips != null && configuredDynamicStepPips == null) return null
    const configuredDynamicMaxLayers = row.configuredDynamicMaxLayers == null ? null : strictLayerCount(row.configuredDynamicMaxLayers)
    if (row.configuredDynamicMaxLayers != null && configuredDynamicMaxLayers == null) return null
    const optimizationStrategy = row.optimizationStrategy == null
      ? null
      : row.optimizationStrategy === 'adjust_percent' || row.optimizationStrategy === 'reduce_layers' || row.optimizationStrategy === 'widen_step'
        ? row.optimizationStrategy
        : null
    if (row.optimizationStrategy != null && optimizationStrategy == null) return null
    const theoreticalLayerCount = row.theoreticalLayerCount == null ? null : strictLayerCount(row.theoreticalLayerCount)
    if (row.theoreticalLayerCount != null && theoreticalLayerCount == null) return null
    const effectiveStepPips = row.effectiveStepPips == null ? null : strictPositiveNumber(row.effectiveStepPips)
    if (row.effectiveStepPips != null && effectiveStepPips == null) return null
    const requestedLayerPercent = row.requestedLayerPercent == null ? null : strictPositiveNumber(row.requestedLayerPercent)
    if (row.requestedLayerPercent != null && (requestedLayerPercent == null || requestedLayerPercent > 100)) return null
    const effectiveLayerPercent = row.effectiveLayerPercent == null ? null : strictPositiveNumber(row.effectiveLayerPercent)
    if (row.effectiveLayerPercent != null && (effectiveLayerPercent == null || effectiveLayerPercent > 100)) return null
    const allocationPercentTotal = row.allocationPercentTotal == null ? null : strictNonNegativeNumber(row.allocationPercentTotal)
    if (row.allocationPercentTotal != null && (allocationPercentTotal == null || allocationPercentTotal > 100)) return null
    if (mode === 'static' && configuredStaticLayerCount == null) {
      return null
    }
    if (mode === 'dynamic' && (configuredDynamicStepPips == null || configuredDynamicMaxLayers == null)) {
      return null
    }
    const originalRangeLow = row.originalRangeLow == null ? null : strictFiniteNumber(row.originalRangeLow)
    const originalRangeHigh = row.originalRangeHigh == null ? null : strictFiniteNumber(row.originalRangeHigh)
    if (
      (row.originalRangeLow != null && originalRangeLow == null)
      || (row.originalRangeHigh != null && originalRangeHigh == null)
      || (originalRangeLow != null && originalRangeHigh != null && originalRangeLow > originalRangeHigh)
    ) return null
    const anchorPrice = row.anchorPrice == null ? null : strictFiniteNumber(row.anchorPrice)
    if (row.anchorPrice != null && anchorPrice == null) return null
    const executableAnchorPrice = row.executableAnchorPrice == null ? null : strictFiniteNumber(row.executableAnchorPrice)
    if (row.executableAnchorPrice != null && executableAnchorPrice == null) return null
    const fundedPrices = row.fundedPrices == null ? null : strictNumberArray(row.fundedPrices)
    if (row.fundedPrices != null && fundedPrices == null) return null
    const lots = row.lots == null ? null : strictPositiveNumberArray(row.lots)
    if (row.lots != null && lots == null) return null
    const reasons = row.reasons == null
      ? Object.freeze([] as string[])
      : Array.isArray(row.reasons) && row.reasons.every(r => typeof r === 'string' && r.length <= 128)
        ? Object.freeze([...new Set(row.reasons as string[])])
        : null
    if (reasons == null) return null
    if (fundedPrices != null) {
      if (!uniqueNumbers(fundedPrices)) return null
      if (originalRangeLow != null && originalRangeHigh != null && fundedPrices.some(p => p < originalRangeLow || p > originalRangeHigh)) return null
      if (!pricesOrdered(side, fundedPrices)) return null
    }
    if ((fundedPrices == null) !== (lots == null)) return null
    if (fundedPrices != null && lots != null && fundedPrices.length !== lots.length) return null
    if (plannedLayerCount != null && fundedPrices != null && plannedLayerCount !== fundedPrices.length) return null
    if (!validatePlanLotTotals(plannedTotalLot, allocatedTotalLot, unallocatedLot, lots)) return null
    if (mode === 'static' && requestedLayerCount != null && configuredStaticLayerCount != null && requestedLayerCount !== configuredStaticLayerCount) {
      return null
    }
    if (mode === 'dynamic' && plannedLayerCount != null && configuredDynamicMaxLayers != null && plannedLayerCount > configuredDynamicMaxLayers) {
      return null
    }
    if (mode === 'dynamic' && executableAnchorPrice != null && fundedPrices != null && fundedPrices[0] !== executableAnchorPrice) {
      return null
    }
    if (
      mode !== 'legacy'
      && (planId == null
        || originalRangeLow == null
        || originalRangeHigh == null
        || requestedLayerCount == null
        || plannedLayerCount == null
        || plannedTotalLot == null
        || allocatedTotalLot == null
        || unallocatedLot == null
        || fundedPrices == null
        || lots == null
        || (mode === 'dynamic' && anchorPrice == null))
    ) return null
    const createdAt = strictTimestamp(row.createdAt)
    const lockedAt = row.lockedAt == null ? null : strictTimestamp(row.lockedAt)
    if (createdAt == null || (row.lockedAt != null && lockedAt == null)) return null
    if (lockedAt != null && Date.parse(lockedAt) < Date.parse(createdAt)) return null
    return {
      schemaVersion,
      calculatorVersion,
      planId: planId ?? 'legacy',
      mode,
      signalId: typeof row.signalId === 'string' ? row.signalId : '',
      brokerAccountId: typeof row.brokerAccountId === 'string' ? row.brokerAccountId : '',
      basketKey: row.basketKey == null ? null : (typeof row.basketKey === 'string' ? row.basketKey : ''),
      symbol: typeof row.symbol === 'string' ? row.symbol : '',
      side,
      originalRangeLow,
      originalRangeHigh,
      anchorPrice,
      executableAnchorPrice,
      anchorSource,
      configuredStaticLayerCount,
      configuredDynamicStepPips,
      configuredDynamicMaxLayers,
      optimizationStrategy,
      theoreticalLayerCount,
      effectiveStepPips,
      requestedLayerPercent,
      effectiveLayerPercent,
      allocationPercentTotal,
      requestedLayerCount,
      plannedLayerCount,
      plannedTotalLot,
      allocatedTotalLot,
      unallocatedLot,
      fundedPrices,
      lots,
      reasons,
      createdAt,
      lockedAt,
    }
  } catch {
    return null
  }
}

export function serializeLayeringPlanSnapshot(snapshot: LayeringPlanSnapshot): Record<string, unknown> | null {
  const parsed = parseLayeringPlanSnapshot(snapshot)
  if (parsed == null) return null
  return { ...parsed }
}

export function changeLayeringPlanMode(
  snapshot: LayeringPlanSnapshot,
  nextMode: LayeringMode,
): LayeringPlanSnapshot {
  if (snapshot.lockedAt && snapshot.mode !== nextMode) {
    throw new Error('locked layering plan mode cannot change')
  }
  return { ...snapshot, mode: nextMode }
}
