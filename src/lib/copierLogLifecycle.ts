import {
  resolveTradeCloseReason,
  type TradeCloseReasonCode,
} from './tradeCloseReason'
import { formatCopierSkipReasonShort } from './copierLogDetail'
import { resolveSignalOpenStatus, type SignalOpenStatusContext } from './signalOverride'
import { interpolate } from '../i18n/interpolate'
import type { CopierLogsTranslations } from '../i18n/locales/types'
import type { Signal } from '../types/database'

/** Display vocabulary for Copier Log (composed; not necessarily `signals.status`). */
export type CopierDisplayStatus =
  | 'parsed'
  | 'executed'
  | 'open'
  | 'skipped'
  | 'failed'
  | 'pending'
  | 'closed'
  | 'partial'

export type CopierLifecycleReasonLabels = {
  reasonParsed: string
  reasonExecuted: string
  reasonOpen: string
  reasonFallback: string
  closeReasons: CopierCloseReasonLabels
}

export type CopierCloseReasonLabels = {
  news_pre_close: string
  signal_close: string
  signal_revision: string
  opposite_signal: string
  partial_tp: string
  auto_management: string
  close_worse_entries: string
  copy_limit_flatten: string
  user_force_close: string
  signal_deleted: string
  position_gone: string
  mirror_source_closed: string
  mirror_copy_closed: string
  stop_loss: string
  take_profit: string
  /** e.g. "TP {n} hit." — used for percent-split / multi-leg baskets. */
  take_profit_level?: string
  unknown: string
}

export type ClosedTradeForCopierLog = {
  id: string
  signal_id: string | null
  telegram_channel_id?: string | null
  symbol: string
  direction?: string | null
  closed_at: string
  close_reason?: string | null
  sl: number | null
  tp: number | null
  close_price?: number | null
  /** 1-based planned TP level when this leg was opened (Single percent-split). */
  next_tp_index?: number | null
}

export type CopierClosedLogDraft = {
  key: string
  at: string
  /** `partial` = this leg closed but sibling legs on the signal are still open/pending. */
  status: 'closed' | 'partial'
  symbol: string
  action: string | null
  reason: string
  signalId: string | null
  channelId: string | null
  messagePreview: string
  messageFull: string
}

export type BuildClosedCopierLogOptions = {
  /** Signal IDs that still have open or pending trades. */
  openSignalIds?: ReadonlySet<string>
  /** Status badge label for a partial basket close (default English). */
  statusPartialClose?: string
  /** Message template when only part of the basket closed, e.g. "Partial close {symbol}". */
  messagePartialClose?: string
}

const SIGNAL_STATUSES = new Set<string>([
  'parsed',
  'executed',
  'skipped',
  'failed',
  'pending',
])

/** Remap executed + open trades → Open; leave other signal statuses as-is. */
export function resolveCopierDisplayStatus(
  signalStatus: string,
  openSignalIds: ReadonlySet<string>,
  signal: Pick<
    Signal,
    'id' | 'channel_id' | 'created_at' | 'parsed_data' | 'parent_signal_id' | 'raw_message'
  >,
  ctx?: SignalOpenStatusContext,
): CopierDisplayStatus {
  const raw = String(signalStatus ?? '').trim().toLowerCase()
  if (raw === 'executed' && resolveSignalOpenStatus(signal, openSignalIds, ctx) === 'open') {
    return 'open'
  }
  if (SIGNAL_STATUSES.has(raw)) return raw as CopierDisplayStatus
  return (raw || 'pending') as CopierDisplayStatus
}

/** 1-based TP level from `next_tp_index` when it looks like a real ladder index. */
export function resolveClosedTradeTpLevel(
  trade: Pick<ClosedTradeForCopierLog, 'next_tp_index'>,
): number | null {
  const n = Number(trade.next_tp_index)
  if (!Number.isFinite(n) || n < 1 || n > 50) return null
  return Math.floor(n)
}

/** Short Copier Log reason for a closed trade (SL/TP inference included). */
export function formatCopierCloseReasonShort(
  trade: Pick<ClosedTradeForCopierLog, 'close_reason' | 'sl' | 'tp' | 'close_price' | 'next_tp_index'>,
  labels: CopierCloseReasonLabels,
  opts?: {
    /**
     * When true (partial basket close), show "TP {n} hit." even for level 1.
     * Otherwise level is only shown for n > 1 — `next_tp_index` defaults to 1
     * on every trade row, so bare TP1 would otherwise relabel every TP close.
     */
    preferTpLevel?: boolean
  },
): string {
  const code = resolveTradeCloseReason(trade.close_reason, {
    sl: trade.sl,
    tp: trade.tp,
    close_price: trade.close_price ?? null,
  })
  if (code === 'take_profit' || code === 'partial_tp') {
    const level = resolveClosedTradeTpLevel(trade)
    const levelTpl = labels.take_profit_level?.trim()
    if (level != null && levelTpl && (opts?.preferTpLevel || level > 1)) {
      return interpolate(levelTpl, { n: level })
    }
  }
  return labels[code] ?? labels.unknown
}

/**
 * Always-on Reason column for a signal row after Open remap.
 * Skipped/Failed keep skip_reason formatting; lifecycle statuses get fixed copy.
 */
export function resolveCopierDisplayReason(
  displayStatus: CopierDisplayStatus,
  skipReason: string | null | undefined,
  labels: CopierLifecycleReasonLabels,
  copierLogs: Pick<CopierLogsTranslations, 'skipReasons'> & Partial<CopierLogsTranslations>,
): string {
  if (displayStatus === 'skipped' || displayStatus === 'failed') {
    const short = formatCopierSkipReasonShort(skipReason, copierLogs as CopierLogsTranslations)
    if (short && short !== '—') return short
    return labels.reasonFallback
  }
  switch (displayStatus) {
    case 'parsed':
      return labels.reasonParsed
    case 'executed':
      return labels.reasonExecuted
    case 'open':
      return labels.reasonOpen
    case 'closed':
      return labels.closeReasons.unknown
    case 'pending':
      return labels.reasonParsed
    default:
      return labels.reasonFallback
  }
}

/** Build one synthetic Closed / Partial Copier Log row from a closed trade. */
export function buildClosedCopierLogDraft(
  trade: ClosedTradeForCopierLog,
  labels: CopierLifecycleReasonLabels,
  opts?: BuildClosedCopierLogOptions,
): CopierClosedLogDraft {
  const side = String(trade.direction ?? '').trim().toLowerCase()
  const action = side === 'buy' || side === 'sell' ? side : 'close'
  const symbol = trade.symbol?.trim() || '—'
  const signalId = trade.signal_id
  const stillOpen = Boolean(
    signalId
    && opts?.openSignalIds
    && opts.openSignalIds.has(signalId),
  )
  const reason = formatCopierCloseReasonShort(trade, labels.closeReasons, {
    preferTpLevel: stillOpen,
  })
  const status: CopierClosedLogDraft['status'] = stillOpen ? 'partial' : 'closed'
  const message = stillOpen
    ? interpolate(opts?.messagePartialClose ?? 'Partial close {symbol}', { symbol })
    : `Closed ${symbol}`
  return {
    key: `trade-close:${trade.id}`,
    at: trade.closed_at,
    status,
    symbol,
    action,
    reason,
    signalId,
    channelId: trade.telegram_channel_id ?? null,
    messagePreview: message,
    messageFull: message,
  }
}

export function buildClosedCopierLogDrafts(
  trades: ReadonlyArray<ClosedTradeForCopierLog>,
  labels: CopierLifecycleReasonLabels,
  opts?: BuildClosedCopierLogOptions,
): CopierClosedLogDraft[] {
  return trades
    .filter(t => Boolean(t.closed_at))
    .map(t => buildClosedCopierLogDraft(t, labels, opts))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** Placeholder Signal so Closed rows can open Signal details before/without a fetch. */
export function signalStubFromClosedDraft(
  draft: CopierClosedLogDraft,
  userId: string,
): Signal {
  return {
    id: draft.signalId ?? draft.key,
    user_id: userId,
    channel_id: draft.channelId,
    raw_message: draft.messageFull,
    raw_image_url: null,
    parsed_data: {
      action: draft.action,
      symbol: draft.symbol,
    },
    status: 'executed',
    skip_reason: null,
    telegram_message_id: null,
    is_modification: false,
    parent_signal_id: null,
    created_at: draft.at,
  }
}

export function copierLifecycleLabelsFromCopierLogs(copierLogs: {
  reasonParsed: string
  reasonExecuted: string
  reasonOpen: string
  reasonFallback: string
  closeReasons: CopierCloseReasonLabels
}): CopierLifecycleReasonLabels {
  return {
    reasonParsed: copierLogs.reasonParsed,
    reasonExecuted: copierLogs.reasonExecuted,
    reasonOpen: copierLogs.reasonOpen,
    reasonFallback: copierLogs.reasonFallback,
    closeReasons: copierLogs.closeReasons,
  }
}

/** Exhaustive short-label map keys for tests / i18n checks. */
export const COPIER_CLOSE_REASON_CODES: readonly TradeCloseReasonCode[] = [
  'news_pre_close',
  'signal_close',
  'signal_revision',
  'opposite_signal',
  'partial_tp',
  'auto_management',
  'close_worse_entries',
  'copy_limit_flatten',
  'user_force_close',
  'signal_deleted',
  'position_gone',
  'mirror_source_closed',
  'mirror_copy_closed',
  'stop_loss',
  'take_profit',
  'unknown',
] as const
