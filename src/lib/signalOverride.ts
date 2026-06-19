import type { Json } from '../types/database'
import { parsedSignalAction } from './copierLogDisplay'

export type SignalUserOverride = {
  sl?: number | null
  tp?: number[]
  entry?: number | null
  updated_at?: string
}

const ENTRY_ACTIONS = new Set(['buy', 'sell'])

function positiveLevel(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTpLevels(tp: unknown): number[] {
  if (!Array.isArray(tp)) return []
  return tp.filter((t): t is number => positiveLevel(t) != null) as number[]
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

export function mergeSignalUserOverride<T extends Record<string, unknown>>(
  parsed: T | null | undefined,
  override: SignalUserOverride | null | undefined,
  opts?: { overlay?: boolean },
): T {
  const base = (parsed && typeof parsed === 'object' ? { ...parsed } : {}) as T & {
    sl?: unknown
    tp?: unknown
  }
  if (!override) return base as T

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
    ;(base as Record<string, unknown>).entry = override.entry
  }

  return base as T
}

export function effectiveParsedData(
  signal: { parsed_data?: Json | null; user_override?: Json | null },
): Record<string, unknown> {
  const parsed = (signal.parsed_data ?? {}) as Record<string, unknown>
  const override = parseUserOverride(signal.user_override)
  return mergeSignalUserOverride(parsed, override, { overlay: true })
}

export function isEditableEntrySignal(
  signal: { parsed_data?: Json | null; channel_id?: string | null },
): boolean {
  if (!signal.channel_id) return false
  const action = parsedSignalAction(signal.parsed_data)
  return ENTRY_ACTIONS.has(action)
}

export function resolveSignalOpenStatus(
  signalId: string,
  openSignalIds: ReadonlySet<string>,
): 'open' | 'closed' {
  return openSignalIds.has(signalId) ? 'open' : 'closed'
}

export function buildOpenSignalIdSet(
  rows: ReadonlyArray<{ signal_id?: string | null }>,
): Set<string> {
  const out = new Set<string>()
  for (const row of rows) {
    const id = row.signal_id?.trim()
    if (id) out.add(id)
  }
  return out
}

export function validateOverrideLevels(args: {
  sl: number | null
  tpLevels: number[]
}): boolean {
  const { sl, tpLevels } = args
  if (sl !== null && !(sl > 0)) return false
  if (tpLevels.some(n => !(n > 0))) return false
  return sl !== null || tpLevels.length > 0
}
