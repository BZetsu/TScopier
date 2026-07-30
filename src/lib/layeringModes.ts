import type { ManualSettings } from '../types/database'

export const LAYERING_MODES = ['legacy', 'static', 'dynamic'] as const
export type LayeringMode = typeof LAYERING_MODES[number]

export const DEFAULT_LAYERING_MODE: LayeringMode = 'legacy'
export const MIN_LAYER_COUNT = 1
export const MAX_LAYER_COUNT = 20
export const DEFAULT_STATIC_LAYER_COUNT = 5
export const DEFAULT_DYNAMIC_STEP_PIPS = 3
export const DEFAULT_DYNAMIC_MAX_LAYERS = 5

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

export function resolveLayeringMode(settings: Pick<ManualSettings, 'layering_mode'> | Record<string, unknown>): LayeringMode {
  const raw = settings.layering_mode
  return raw === 'static' || raw === 'dynamic' || raw === 'legacy' ? raw : DEFAULT_LAYERING_MODE
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
