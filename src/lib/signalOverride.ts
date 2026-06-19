import type { Json, Signal } from '../types/database'
import {
  MANAGEMENT_COPIER_ACTIONS,
  parsedSignalAction,
  resolveRecentChannelEntrySignalId,
  symbolForCopierLog,
  type CopierSymbolContext,
} from './copierLogDisplay'

export type SignalUserOverride = {
  sl?: number | null
  tp?: number[]
  entry?: number | null
  updated_at?: string
}

const ENTRY_ACTIONS = new Set(['buy', 'sell'])

/** Management actions that adjust displayed SL/TP on the anchor entry row. */
const SL_TP_MGMT_ACTIONS = new Set(['modify', 'breakeven', 'partial_breakeven'])

export type SignalBatchRow = Pick<
  Signal,
  | 'id'
  | 'channel_id'
  | 'created_at'
  | 'parsed_data'
  | 'raw_message'
  | 'parent_signal_id'
  | 'user_override'
  | 'reply_to_message_id'
  | 'is_modification'
>

export type SignalDisplayContext = {
  batchSignals: ReadonlyArray<SignalBatchRow>
  symbolContext?: CopierSymbolContext
  replyParentBySignalId?: ReadonlyMap<string, string>
}

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

function applyMgmtParsedToEntry(
  parsed: Record<string, unknown>,
  mgmtParsed: unknown,
): Record<string, unknown> {
  const next = { ...parsed }
  const mgmt = (mgmtParsed ?? {}) as Record<string, unknown>
  const action = parsedSignalAction(mgmtParsed)
  if (action === 'modify' || action === 'breakeven' || action === 'partial_breakeven') {
    const sl = positiveLevel(mgmt.sl)
    if (sl != null) next.sl = sl
    const tp = normalizeTpLevels(mgmt.tp)
    if (tp.length > 0) next.tp = tp
  }
  return next
}

function findEntryInParentChain(
  signalId: string,
  batchById: ReadonlyMap<string, SignalBatchRow>,
  replyParentBySignalId?: ReadonlyMap<string, string>,
): SignalBatchRow | null {
  let current: string | null | undefined = signalId
  for (let depth = 0; current && depth < 24; depth++) {
    const row = batchById.get(current)
    if (!row) return null
    const action = parsedSignalAction(row.parsed_data)
    if (ENTRY_ACTIONS.has(action)) return row
    current = row.parent_signal_id?.trim()
      ?? replyParentBySignalId?.get(row.id)?.trim()
      ?? null
  }
  return null
}

function hasIntermediateEntryForSymbol(
  entry: SignalBatchRow,
  mgmt: SignalBatchRow,
  batchSignals: ReadonlyArray<SignalBatchRow>,
  ctx?: SignalDisplayContext,
): boolean {
  const entryMs = Date.parse(entry.created_at)
  const mgmtMs = Date.parse(mgmt.created_at)
  if (!Number.isFinite(entryMs) || !Number.isFinite(mgmtMs)) return false
  const symbolContext = ctx?.symbolContext ?? { lookup: new Map(), replyParentBySignalId: new Map() }
  const sym = symbolForCopierLog(entry, symbolContext, [...batchSignals])
  if (!sym || sym === '—') return false

  for (const row of batchSignals) {
    if (row.id === entry.id) continue
    if (!ENTRY_ACTIONS.has(parsedSignalAction(row.parsed_data))) continue
    const rowMs = Date.parse(row.created_at)
    if (!Number.isFinite(rowMs) || rowMs <= entryMs || rowMs >= mgmtMs) continue
    const rowSym = symbolForCopierLog(row, symbolContext, [...batchSignals])
    if (rowSym === sym) return true
  }
  return false
}

export function resolveManagementAnchorEntryId(
  mgmt: SignalBatchRow,
  batchSignals: ReadonlyArray<SignalBatchRow>,
  ctx?: SignalDisplayContext,
): string | null {
  const action = parsedSignalAction(mgmt.parsed_data)
  if (!MANAGEMENT_COPIER_ACTIONS.has(action)) return null

  const batchById = new Map(batchSignals.map(row => [row.id, row]))
  const replyParentBySignalId = ctx?.replyParentBySignalId ?? ctx?.symbolContext?.replyParentBySignalId

  const parentId = mgmt.parent_signal_id?.trim()
    ?? replyParentBySignalId?.get(mgmt.id)?.trim()
  if (parentId) {
    const entry = findEntryInParentChain(parentId, batchById, replyParentBySignalId)
    if (entry) return entry.id
  }

  const entryId = resolveRecentChannelEntrySignalId(mgmt, [...batchSignals])
  if (!entryId) return null

  const symbolContext = ctx?.symbolContext ?? { lookup: new Map(), replyParentBySignalId: new Map() }
  const mgmtSymbol = symbolForCopierLog(mgmt, symbolContext, [...batchSignals])
  const entry = batchById.get(entryId)
  if (!entry) return null
  const entrySymbol = symbolForCopierLog(entry, symbolContext, [...batchSignals])
  if (mgmtSymbol !== '—' && entrySymbol !== '—' && mgmtSymbol !== entrySymbol) return null
  return entryId
}

export function collectMgmtUpdatesForEntry(
  entry: SignalBatchRow,
  batchSignals: ReadonlyArray<SignalBatchRow>,
  ctx?: SignalDisplayContext,
): SignalBatchRow[] {
  if (!ENTRY_ACTIONS.has(parsedSignalAction(entry.parsed_data))) return []

  return batchSignals
    .filter(row => {
      if (row.id === entry.id) return false
      const action = parsedSignalAction(row.parsed_data)
      if (!SL_TP_MGMT_ACTIONS.has(action)) return false
      if (resolveManagementAnchorEntryId(row, batchSignals, ctx) !== entry.id) return false
      return !hasIntermediateEntryForSymbol(entry, row, batchSignals, ctx)
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

export function foldMgmtUpdatesIntoParsed(
  entry: SignalBatchRow,
  batchSignals: ReadonlyArray<SignalBatchRow>,
  ctx?: SignalDisplayContext,
): Record<string, unknown> {
  let parsed = { ...((entry.parsed_data ?? {}) as Record<string, unknown>) }
  for (const update of collectMgmtUpdatesForEntry(entry, batchSignals, ctx)) {
    parsed = applyMgmtParsedToEntry(parsed, update.parsed_data)
  }
  return parsed
}

/** Channel entry + folded modify/breakeven updates + user override (Manage Signals display). */
export function effectiveDisplayParsedData(
  signal: SignalBatchRow,
  ctx?: SignalDisplayContext,
): Record<string, unknown> {
  const base = ctx?.batchSignals?.length && ENTRY_ACTIONS.has(parsedSignalAction(signal.parsed_data))
    ? foldMgmtUpdatesIntoParsed(signal, ctx.batchSignals, ctx)
    : ((signal.parsed_data ?? {}) as Record<string, unknown>)
  const override = parseUserOverride(signal.user_override)
  return mergeSignalUserOverride(base, override, { overlay: true })
}

export type ConsolidatedEntrySignal = {
  signal: Signal
  lastActivityAt: string
}

export function buildConsolidatedEntrySignals(
  signals: Signal[],
  ctx?: SignalDisplayContext,
): ConsolidatedEntrySignal[] {
  const batch = ctx?.batchSignals ?? signals
  const entries = signals.filter(isEditableEntrySignal)

  return entries.map(signal => {
    const updates = collectMgmtUpdatesForEntry(signal, batch, ctx)
    const lastUpdate = updates.length
      ? updates.reduce((latest, row) => {
        const ms = Date.parse(row.created_at)
        return ms > Date.parse(latest) ? row.created_at : latest
      }, signal.created_at)
      : signal.created_at
    return { signal, lastActivityAt: lastUpdate }
  })
}

export function isHiddenManagementSignal(
  signal: Pick<Signal, 'parsed_data' | 'channel_id'>,
): boolean {
  if (!signal.channel_id) return true
  const action = parsedSignalAction(signal.parsed_data)
  return MANAGEMENT_COPIER_ACTIONS.has(action)
}

export function isEditableEntrySignal(
  signal: { parsed_data?: Json | null; channel_id?: string | null },
): boolean {
  if (!signal.channel_id) return false
  const action = parsedSignalAction(signal.parsed_data)
  return ENTRY_ACTIONS.has(action)
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

export type SignalOpenStatusContext = {
  batchSignals?: ReadonlyArray<
    Pick<Signal, 'id' | 'channel_id' | 'created_at' | 'parsed_data' | 'parent_signal_id' | 'raw_message'>
  >
  replyParentBySignalId?: ReadonlyMap<string, string>
}

function buildParentSignalIdMap(
  ctx?: SignalOpenStatusContext,
): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const row of ctx?.batchSignals ?? []) {
    map.set(row.id, row.parent_signal_id ?? null)
  }
  return map
}

function isOpenViaParentChain(
  signal: Pick<Signal, 'id' | 'parent_signal_id'>,
  openSignalIds: ReadonlySet<string>,
  ctx?: SignalOpenStatusContext,
): boolean {
  const parentMap = buildParentSignalIdMap(ctx)
  let current = signal.parent_signal_id?.trim()
    ?? ctx?.replyParentBySignalId?.get(signal.id)?.trim()
    ?? null
  for (let depth = 0; current && depth < 24; depth++) {
    if (openSignalIds.has(current)) return true
    current = parentMap.get(current)?.trim() ?? null
  }
  return false
}

export function resolveSignalOpenStatus(
  signal: Pick<
    Signal,
    'id' | 'channel_id' | 'created_at' | 'parsed_data' | 'parent_signal_id' | 'raw_message'
  >,
  openSignalIds: ReadonlySet<string>,
  ctx?: SignalOpenStatusContext,
): 'open' | 'closed' {
  if (openSignalIds.has(signal.id)) return 'open'
  if (isOpenViaParentChain(signal, openSignalIds, ctx)) return 'open'

  const action = parsedSignalAction(signal.parsed_data)
  if (MANAGEMENT_COPIER_ACTIONS.has(action) && ctx?.batchSignals?.length) {
    const entryId = resolveRecentChannelEntrySignalId(signal, [...ctx.batchSignals])
    if (entryId && openSignalIds.has(entryId)) return 'open'
  }

  return 'closed'
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
