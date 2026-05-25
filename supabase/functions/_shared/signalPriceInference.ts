/**
 * Directional TP/SL inference from bare prices and re-enter intent detection.
 */

export type TradeDirection = 'buy' | 'sell'

export type ClassifiedStops = {
  sl: number | null
  tp: number[]
}

/** True when the channel explicitly asks to add a new trade (not modify existing). */
export function detectReEnterIntent(message: string): boolean {
  return /\bre[-\s]?enter\b/i.test(String(message ?? ''))
}

export function parsedHasReEnterIntent(parsed: {
  re_enter?: boolean
  raw_instruction?: string
} | null | undefined): boolean {
  if (!parsed) return false
  if (parsed.re_enter === true) return true
  return detectReEnterIntent(parsed.raw_instruction ?? '')
}

function positivePrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function uniquePrices(prices: number[]): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const p of prices) {
    const n = positivePrice(p)
    if (n == null || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Classify bare prices into SL and TPs relative to trade direction and optional entry.
 * Sell: SL above reference, TPs below. Buy: inverse.
 * Without entry reference: sell uses max as SL; buy uses min as SL.
 */
export function classifyPricesByDirection(
  action: TradeDirection,
  entryRef: number | null,
  prices: number[],
): ClassifiedStops {
  const nums = uniquePrices(prices)
  if (!nums.length) return { sl: null, tp: [] }

  const isSell = action === 'sell'

  if (entryRef != null && entryRef > 0) {
    const slCandidates = nums.filter(p => (isSell ? p > entryRef : p < entryRef))
    const tpCandidates = nums.filter(p => (isSell ? p < entryRef : p > entryRef))
    const sl = slCandidates.length
      ? (isSell ? Math.max(...slCandidates) : Math.min(...slCandidates))
      : null
    const tp = isSell
      ? [...tpCandidates].sort((a, b) => b - a)
      : [...tpCandidates].sort((a, b) => a - b)
    return { sl, tp }
  }

  if (nums.length === 1) {
    return { sl: null, tp: nums }
  }

  const sl = isSell ? Math.max(...nums) : Math.min(...nums)
  const tp = nums.filter(p => p !== sl)
  const sortedTp = isSell
    ? [...tp].sort((a, b) => b - a)
    : [...tp].sort((a, b) => a - b)
  return { sl, tp: sortedTp }
}

type LabeledPriceSpan = { start: number; end: number; value: number }

function collectLabeledSpans(message: string): LabeledPriceSpan[] {
  const text = String(message ?? '')
  const spans: LabeledPriceSpan[] = []

  const addMatches = (rx: RegExp) => {
    for (const m of text.matchAll(rx)) {
      const value = Number(m[1])
      if (!Number.isFinite(value) || value <= 0) continue
      spans.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        value,
      })
    }
  }

  addMatches(/\b(?:sl|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)
  addMatches(/\b(?:sl|stop\s*loss)\s+to\s+(\d+(?:\.\d+)?)/gi)
  addMatches(/\b(?:tp|take\s*profit|target)\s*#\s*\d+\s*[:=\-]\s*(\d+(?:\.\d+)?)/gi)
  addMatches(/\b(?:tp|take\s*profit|target)\s+\d+\s*[:=\-]\s*(\d+(?:\.\d+)?)/gi)
  addMatches(/\b(?:tp|take\s*profit|target)\s*\d+\s+(\d+(?:\.\d+)?)/gi)
  addMatches(/\b(?:tp|take\s*profit|target)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)
  addMatches(/\bentry\s*(?:price)?\s*[:=]\s*(\d+(?:\.\d+)?)/gi)
  addMatches(/@\s*(\d+(?:\.\d+)?)/g)
  addMatches(/\b(?:buy|sell)\s+at\s+(\d+(?:\.\d+)?)/gi)
  addMatches(/\bentry\s+(\d+(?:\.\d+)?)/gi)

  for (const m of text.matchAll(
    /\b(?:tp|take\s*profit|target)\s*[:=]?\s*((?:\d+(?:\.\d+)?(?:\s*(?:\/|,|and|\|)\s*)?)+\d+(?:\.\d+)?)/gi,
  )) {
    const block = m[1] ?? ''
    const base = m.index ?? 0
    const offset = m[0].indexOf(block)
    for (const part of block.split(/\s*(?:\/|,|\band\b|\|)\s*/i)) {
      const value = Number(part.trim())
      if (!Number.isFinite(value) || value <= 0) continue
      const partStart = base + offset + block.indexOf(part)
      spans.push({ start: partStart, end: partStart + part.length, value })
    }
  }

  return spans
}

function isInsideSpan(index: number, length: number, spans: LabeledPriceSpan[]): boolean {
  const end = index + length
  return spans.some(s => index >= s.start && end <= s.end)
}

function isInsideParenthetical(index: number, text: string): boolean {
  const before = text.slice(0, index)
  const open = before.lastIndexOf('(')
  const close = before.lastIndexOf(')')
  return open > close
}

/** Prices in the message not already tied to SL/TP/entry labels. */
export function extractUnlabeledPrices(message: string): number[] {
  const text = String(message ?? '')
  const labeled = collectLabeledSpans(text)
  const out: number[] = []
  const seen = new Set<number>()

  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const raw = m[0]
    const index = m.index ?? 0
    if (isInsideSpan(index, raw.length, labeled)) continue
    if (isInsideParenthetical(index, text)) continue

    const after = text.slice(index + raw.length).trimStart()
    if (after.startsWith('(')) {
      const close = after.indexOf(')')
      if (close > 0) {
        const inner = after.slice(1, close).trim()
        if (/^\d+(?:\.\d+)?$/.test(inner)) continue
      }
    }

    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }

  return out
}

export function entryReferenceFromParsed(parsed: {
  entry_price?: number | null
  entry_zone_low?: number | null
  entry_zone_high?: number | null
}): number | null {
  const ep = positivePrice(parsed.entry_price)
  if (ep != null) return ep
  const lo = positivePrice(parsed.entry_zone_low)
  const hi = positivePrice(parsed.entry_zone_high)
  if (lo != null && hi != null) return (lo + hi) / 2
  return null
}
