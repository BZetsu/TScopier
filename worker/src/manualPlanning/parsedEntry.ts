import type { ParsedSignal } from './types'

function readPositiveNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Best-effort entry price from `parsed_data` (handles string decimals and
 * occasional camelCase keys from non–parse-signal writers).
 */
export function resolvedParsedEntryPrice(parsed: ParsedSignal): number | null {
  const ext = parsed as unknown as Record<string, unknown>
  return (
    readPositiveNum(parsed.entry_price)
    ?? readPositiveNum(ext.entryPrice)
    ?? readPositiveNum(ext.entry_point)
  )
}

/** Entry zone low/high with the same coercion as {@link resolvedParsedEntryPrice}. */
export function resolvedParsedEntryZone(parsed: ParsedSignal): { lo: number; hi: number } | null {
  const ext = parsed as unknown as Record<string, unknown>
  const lo = readPositiveNum(parsed.entry_zone_low) ?? readPositiveNum(ext.entryZoneLow)
  const hi = readPositiveNum(parsed.entry_zone_high) ?? readPositiveNum(ext.entryZoneHigh)
  if (lo == null || hi == null) return null
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }
}

/** Ordered entry pair as written in the signal (first mentioned → last mentioned). */
export function resolvedParsedEntryZoneOrdered(
  parsed: ParsedSignal,
): { first: number; last: number } | null {
  const ext = parsed as unknown as Record<string, unknown>
  const first =
    readPositiveNum(parsed.entry_zone_first)
    ?? readPositiveNum(ext.entryZoneFirst)
  const last =
    readPositiveNum(parsed.entry_zone_last)
    ?? readPositiveNum(ext.entryZoneLast)
  if (first != null && last != null) return { first, last }
  return null
}

export type SignalEntryPrefer = 'first_price' | 'last_price'

export function normalizeSignalEntryPrefer(raw: unknown): SignalEntryPrefer {
  return String(raw ?? 'first_price').toLowerCase() === 'last_price'
    ? 'last_price'
    : 'first_price'
}

/**
 * Collapse a dual entry (ordered pair or min/max zone) to one price for
 * Use Signal Entry Price. Prefers text order when available; otherwise lo/hi.
 * When an ordered pair exists it wins over a scalar `entry_price` so dual quotes
 * are not stuck on a first-only parse.
 */
export function resolvePreferredSignalEntryPrice(
  parsed: ParsedSignal,
  prefer: SignalEntryPrefer,
): number | null {
  const ordered = resolvedParsedEntryZoneOrdered(parsed)
  if (ordered) {
    return prefer === 'last_price' ? ordered.last : ordered.first
  }
  const z = resolvedParsedEntryZone(parsed)
  if (z) {
    return prefer === 'last_price' ? z.hi : z.lo
  }
  return resolvedParsedEntryPrice(parsed)
}

/**
 * True when the parsed signal includes an explicit entry **price** or **zone**
 * (not a bare market “buy now”). Used with strict signal entry so planning
 * only runs when the message specifies an entry anchor.
 */
export function parsedHasExplicitEntryAnchor(parsed: ParsedSignal): boolean {
  if (resolvedParsedEntryPrice(parsed) != null) return true
  if (resolvedParsedEntryZoneOrdered(parsed) != null) return true
  const z = resolvedParsedEntryZone(parsed)
  return z != null && z.lo > 0 && z.hi > 0
}

/**
 * Rightmost positive TP from parsed signal data (TP3 when three levels are present).
 */
export function lastPositiveParsedTpPrice(parsed: { tp?: unknown } | null | undefined): number | null {
  const arr = parsed?.tp
  if (!Array.isArray(arr) || arr.length === 0) return null
  for (let i = arr.length - 1; i >= 0; i--) {
    const raw = arr[i]
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Planner / executor skip when strict signal entry is on but the parse has no entry anchor. */
export const SKIP_REASON_SIGNAL_ENTRY_REQUIRED = 'signal_entry_price_requires_explicit_entry' as const

/** Planner / executor skip when use signal range is on but the parse has no price or zone. */
export const SKIP_REASON_SIGNAL_ENTRY_RANGE_REQUIRED = 'signal_entry_range_requires_price' as const

/** All range-entry waits expired without opening a basket. */
export const SKIP_REASON_SIGNAL_ENTRY_RANGE_EXPIRED = 'signal_entry_range_expired' as const

/** Entry dispatch ran but no broker opened or merged a position. */
export const SKIP_REASON_ENTRY_NOT_OPENED = 'entry_not_opened' as const

/** The live quote already passed an explicit broker limit level, so the order would be rejected. */
export const SKIP_REASON_LEVEL_ALREADY_PASSED = 'level_already_passed' as const
