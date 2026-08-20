/**
 * Per-signal user SL/TP overrides (Manage Signals). Mirror of src/lib/signalOverride.ts.
 */

import type { ParsedSignal } from './manualPlanning/types'

export type SignalUserOverride = {
  sl?: number | null
  tp?: number[]
  entry?: number | null
  updated_at?: string
}

function positiveLevel(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTpLevels(tp: unknown): number[] {
  if (!Array.isArray(tp)) return []
  return tp.filter((t): t is number => positiveLevel(t) != null) as number[]
}

function emptyParsed(): ParsedSignal {
  return {
    action: 'ignore',
    symbol: null,
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl: null,
    tp: null,
    lot_size: null,
  }
}

export function userOverrideHasStopLevels(
  override: SignalUserOverride | null | undefined,
): boolean {
  if (!override) return false
  if (override.sl != null && override.sl > 0) return true
  return Array.isArray(override.tp) && override.tp.some(t => Number(t) > 0)
}

/**
 * True while a Manage Signals override still owns SL/TP.
 * A later Telegram Adjust/BE (`laterInstructionAt` after `updated_at`) takes over.
 */
export function userOverrideInForce(
  override: SignalUserOverride | null | undefined,
  laterInstructionAt?: string | null,
): boolean {
  if (!userOverrideHasStopLevels(override)) return false
  if (!laterInstructionAt) return true
  const laterAt = Date.parse(laterInstructionAt)
  if (!Number.isFinite(laterAt)) return true
  const overrideAt = override?.updated_at ? Date.parse(override.updated_at) : NaN
  if (!Number.isFinite(overrideAt)) return false
  return laterAt <= overrideAt
}

export function parseUserOverride(raw: unknown): SignalUserOverride | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const sl = row.sl === null || row.sl === undefined ? undefined : positiveLevel(row.sl)
  const tp = row.tp === undefined ? undefined : normalizeTpLevels(row.tp)
  const entry = row.entry === null || row.entry === undefined ? undefined : positiveLevel(row.entry)
  const updated_at = typeof row.updated_at === 'string' ? row.updated_at : undefined
  if (sl === undefined && tp === undefined && entry === undefined && !updated_at) return null
  return { sl, tp, entry, updated_at }
}

export function mergeSignalUserOverride(
  parsed: ParsedSignal | null | undefined,
  override: SignalUserOverride | null | undefined,
  opts?: { overlay?: boolean },
): ParsedSignal {
  const base: ParsedSignal = parsed
    ? { ...parsed, tp: parsed.tp ? [...parsed.tp] : parsed.tp }
    : emptyParsed()

  if (!override) return base

  const hasSl = positiveLevel(base.sl) != null
  const hasTp = normalizeTpLevels(base.tp).length > 0
  const overlay = opts?.overlay === true

  if (overlay || override.sl != null) {
    if (override.sl != null) base.sl = override.sl
    else if (override.sl === null && overlay) base.sl = null
  } else if (!hasSl && override.sl != null) {
    base.sl = override.sl
  }

  if (overlay || (override.tp != null && override.tp.length > 0)) {
    if (override.tp != null && override.tp.length > 0) base.tp = [...override.tp]
    else if (override.tp != null && overlay) base.tp = []
  } else if (!hasTp && override.tp != null && override.tp.length > 0) {
    base.tp = [...override.tp]
  }

  if (override.entry != null || (override.entry === null && overlay)) {
    base.entry_price = override.entry ?? null
  }

  return base
}

export function effectiveParsedFromSignalRow(
  signal: { parsed_data?: ParsedSignal | null; user_override?: unknown },
): ParsedSignal {
  return mergeSignalUserOverride(signal.parsed_data, parseUserOverride(signal.user_override), {
    overlay: true,
  })
}

export function applyUserOverrideToSignalRow<T extends { parsed_data?: ParsedSignal | null; user_override?: unknown }>(
  row: T,
): T {
  const override = parseUserOverride(row.user_override)
  if (!override) return row
  return {
    ...row,
    parsed_data: mergeSignalUserOverride(row.parsed_data, override, { overlay: true }),
  }
}
