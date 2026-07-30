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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeInteger(value: unknown, fallback: number): number {
  const n = finiteNumber(value)
  if (n == null) return fallback
  return Math.max(MIN_LAYER_COUNT, Math.min(MAX_LAYER_COUNT, Math.floor(n)))
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const n = finiteNumber(value)
  if (n == null || n <= 0) return fallback
  return n
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

export function parseLayeringPlanSnapshot(raw: unknown): LayeringPlanSnapshot {
  const row = isRecord(raw) ? raw : {}
  const rawMode = row.mode
  const mode: LayeringMode = rawMode === 'static' || rawMode === 'dynamic' || rawMode === 'legacy'
    ? rawMode
    : 'legacy'
  const anchorSource = ANCHOR_SOURCES.has(row.anchorSource as LayerPlanAnchorSource)
    ? row.anchorSource as LayerPlanAnchorSource
    : 'unknown'
  const planId = typeof row.planId === 'string' && row.planId.trim() ? row.planId.trim() : 'legacy'
  const plannedLayerCount = finiteNumber(row.plannedLayerCount)
  if (plannedLayerCount != null && (plannedLayerCount < 1 || plannedLayerCount > MAX_LAYER_COUNT)) {
    throw new Error('invalid planned layer count')
  }
  const configuredStaticLayerCount = finiteNumber(row.configuredStaticLayerCount)
  const configuredDynamicStepPips = finiteNumber(row.configuredDynamicStepPips)
  const configuredDynamicMaxLayers = finiteNumber(row.configuredDynamicMaxLayers)
  if (mode === 'static' && configuredStaticLayerCount == null) {
    throw new Error('static layering snapshot requires static layer count')
  }
  if (mode === 'dynamic' && (configuredDynamicStepPips == null || configuredDynamicMaxLayers == null)) {
    throw new Error('dynamic layering snapshot requires step and max layers')
  }
  return {
    planId,
    mode,
    signalId: typeof row.signalId === 'string' ? row.signalId : '',
    brokerAccountId: typeof row.brokerAccountId === 'string' ? row.brokerAccountId : '',
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    side: row.side === 'sell' ? 'sell' : 'buy',
    originalRangeLow: finiteNumber(row.originalRangeLow),
    originalRangeHigh: finiteNumber(row.originalRangeHigh),
    anchorPrice: finiteNumber(row.anchorPrice),
    anchorSource,
    configuredStaticLayerCount,
    configuredDynamicStepPips,
    configuredDynamicMaxLayers,
    plannedLayerCount,
    plannedTotalLot: finiteNumber(row.plannedTotalLot),
    createdAt: typeof row.createdAt === 'string' && row.createdAt ? row.createdAt : new Date(0).toISOString(),
    lockedAt: typeof row.lockedAt === 'string' && row.lockedAt ? row.lockedAt : null,
  }
}

export function serializeLayeringPlanSnapshot(snapshot: LayeringPlanSnapshot): Record<string, unknown> {
  const parsed = parseLayeringPlanSnapshot(snapshot)
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
