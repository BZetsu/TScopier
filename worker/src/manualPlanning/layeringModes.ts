import type {
  LayeringMode,
  LayeringPlanSnapshot,
  LayerPlanAnchorSource,
  ManualSettings,
} from './types'

export const LAYERING_MODES = ['legacy', 'static', 'dynamic'] as const
export const DEFAULT_LAYERING_MODE: LayeringMode = 'legacy'
export const MIN_LAYER_COUNT = 1
export const MAX_LAYER_COUNT = 20
export const DEFAULT_STATIC_LAYER_COUNT = 5
export const DEFAULT_DYNAMIC_MAX_LAYERS = 5
export const DEFAULT_DYNAMIC_STEP_PIPS = 3

const ANCHOR_SOURCES = new Set<LayerPlanAnchorSource>(['signal', 'quote', 'fill', 'unknown'])
export const MIN_LAYER_PLAN_ID_LENGTH = 8
export const MAX_LAYER_PLAN_ID_LENGTH = 128
const LAYER_PLAN_ID_RE = /^[A-Za-z0-9_-]+$/

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
  const raw = String(process.env.LAYERING_MODES_EXECUTION_ENABLED ?? 'false').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
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
  const suffix = layeringModesExecutionEnabled() ? 'not_implemented' : 'execution_disabled'
  return { ok: false, reason: `layering_mode_${mode}_${suffix}` }
}

export function parseLayeringPlanSnapshot(raw: unknown): LayeringPlanSnapshot | null {
  try {
    if (raw == null) {
      return {
        planId: 'legacy',
        mode: 'legacy',
        signalId: '',
        brokerAccountId: '',
        symbol: '',
        side: 'buy',
        originalRangeLow: null,
        originalRangeHigh: null,
        anchorPrice: null,
        anchorSource: 'unknown',
        configuredStaticLayerCount: null,
        configuredDynamicStepPips: null,
        configuredDynamicMaxLayers: null,
        plannedLayerCount: null,
        plannedTotalLot: null,
        createdAt: new Date(0).toISOString(),
        lockedAt: null,
      }
    }
    if (!isRecord(raw)) return null
    const row = raw
    const rawMode = row.mode
    if (rawMode !== 'static' && rawMode !== 'dynamic' && rawMode !== 'legacy') return null
    const mode: LayeringMode = rawMode
    const anchorSource = ANCHOR_SOURCES.has(row.anchorSource as LayerPlanAnchorSource)
      ? row.anchorSource as LayerPlanAnchorSource
      : null
    if (anchorSource == null) return null
    const planId = isValidLayerPlanId(row.planId) ? row.planId : null
    if (planId == null && mode !== 'legacy') return null
    const plannedLayerCount = row.plannedLayerCount == null ? null : strictLayerCount(row.plannedLayerCount)
    if (row.plannedLayerCount != null && plannedLayerCount == null) return null
    const plannedTotalLot = row.plannedTotalLot == null ? null : strictNonNegativeNumber(row.plannedTotalLot)
    if (row.plannedTotalLot != null && plannedTotalLot == null) return null
    const configuredStaticLayerCount = row.configuredStaticLayerCount == null ? null : strictLayerCount(row.configuredStaticLayerCount)
    if (row.configuredStaticLayerCount != null && configuredStaticLayerCount == null) return null
    const configuredDynamicStepPips = row.configuredDynamicStepPips == null ? null : strictPositiveNumber(row.configuredDynamicStepPips)
    if (row.configuredDynamicStepPips != null && configuredDynamicStepPips == null) return null
    const configuredDynamicMaxLayers = row.configuredDynamicMaxLayers == null ? null : strictLayerCount(row.configuredDynamicMaxLayers)
    if (row.configuredDynamicMaxLayers != null && configuredDynamicMaxLayers == null) return null
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
    if (
      mode !== 'legacy'
      && (planId == null
        || originalRangeLow == null
        || originalRangeHigh == null
        || plannedLayerCount == null
        || plannedTotalLot == null
        || (mode === 'dynamic' && anchorPrice == null))
    ) return null
    const createdAt = strictTimestamp(row.createdAt)
    const lockedAt = row.lockedAt == null ? null : strictTimestamp(row.lockedAt)
    if (createdAt == null || (row.lockedAt != null && lockedAt == null)) return null
    if (lockedAt != null && Date.parse(lockedAt) < Date.parse(createdAt)) return null
    return {
      planId: planId ?? 'legacy',
      mode,
      signalId: typeof row.signalId === 'string' ? row.signalId : '',
      brokerAccountId: typeof row.brokerAccountId === 'string' ? row.brokerAccountId : '',
      symbol: typeof row.symbol === 'string' ? row.symbol : '',
      side: row.side === 'sell' ? 'sell' : 'buy',
      originalRangeLow,
      originalRangeHigh,
      anchorPrice,
      anchorSource,
      configuredStaticLayerCount,
      configuredDynamicStepPips,
      configuredDynamicMaxLayers,
      plannedLayerCount,
      plannedTotalLot,
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
