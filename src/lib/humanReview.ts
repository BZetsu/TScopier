import type { Signal } from '../types/database'

export const HUMAN_REVIEW_SKIP_REASON = 'ai classified as uncertain; human review required'

/** Fixed two-minute approval window (matches AI_REVIEW_MAX_AGE_MS in the worker). */
export const HUMAN_REVIEW_WINDOW_MS = 2 * 60_000

export function isHumanReviewSignal(signal: {
  status?: string | null
  skip_reason?: string | null
}): boolean {
  if (String(signal.status ?? '').toLowerCase() !== 'skipped') return false
  return String(signal.skip_reason ?? '').trim().toLowerCase() === HUMAN_REVIEW_SKIP_REASON
}

/** Milliseconds left in the approval window; 0 when expired or unknown. */
export function reviewRemainingMs(createdAt: string | undefined, now = Date.now()): number {
  if (!createdAt) return 0
  const createdMs = Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) return 0
  return Math.max(0, createdMs + HUMAN_REVIEW_WINDOW_MS - now)
}

/** Compact countdown label shared by the review modal and the trades queue. */
export function formatReviewRemaining(ms: number): string {
  if (ms <= 0) return 'expired'
  const totalSec = Math.ceil(ms / 1000)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return min > 0 ? `${min}m ${sec}s left` : `${sec}s left`
}

export type ReviewParsedLevels = {
  action: string | null
  symbol: string | null
  entry: string | null
  sl: string | null
  tp: string | null
}

export function reviewParsedLevels(signal: Signal): ReviewParsedLevels {
  const p = (signal.parsed_data ?? {}) as Record<string, unknown>
  const entry = p.entry_price as number | null
  const zoneLow = p.entry_zone_low as number | null
  const zoneHigh = p.entry_zone_high as number | null
  const entryText = zoneLow != null && zoneHigh != null
    ? `${zoneLow} – ${zoneHigh}`
    : entry != null
      ? String(entry)
      : null
  return {
    action: String(p.action ?? '').trim() || null,
    symbol: String(p.symbol ?? '').trim() || null,
    entry: entryText,
    sl: p.sl != null ? String(p.sl) : null,
    tp: Array.isArray(p.tp) && p.tp.length > 0 ? p.tp.join(', ') : null,
  }
}
