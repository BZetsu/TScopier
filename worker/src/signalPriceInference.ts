/**
 * Directional TP/SL inference from bare prices and re-enter intent detection.
 */

import { SIGNAL_PRICE_NUM, parseSignalPriceListBlock, parseSignalPriceToken, signalPriceTokenRegex } from './signalPriceFormat'
import { isPercentagePriceAt } from './signalCommentaryGuard'
import { isProviderSignalNumberToken } from './forexBroSignalPatterns'

export type TradeDirection = 'buy' | 'sell'

export type ClassifiedStops = {
  sl: number | null
  tp: number[]
}

/** True when the channel explicitly asks to add a new trade (not modify existing). */
export function detectReEnterIntent(message: string): boolean {
  return /\b(?:re[-\s]?(?:entry|enter)|reenter)\b/i.test(String(message ?? ''))
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
      const value = parseSignalPriceToken(m[1])
      if (value == null) continue
      spans.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        value,
      })
    }
  }

  addMatches(new RegExp(`\\b(?:sl|stop\\s*loss)\\s*[:=]?\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\b(?:sl|stop\\s*loss)\\s+to\\s+(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\btp\\s*\\.\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\b(?:tp|take\\s*profit|target(?:\\s+level)?)\\s*#\\s*\\d+\\s*[:=\\-]\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\b(?:tp|take\\s*profit|target(?:\\s+level)?)\\s+\\d+\\s*[:=\\-]\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  // Tier index is 1–2 digits, price on the next line — matches extractTpLevels.
  // The 1–2 digit bound stops "TP 4105" and a following "100%" joining up; the
  // `(?!\s*%)` guard stops a "100% sure" line being read as a price.
  addMatches(new RegExp(`\\b(?:tp|take\\s*profit|target(?:\\s+level)?)\\s*\\d{1,2}\\s+(${SIGNAL_PRICE_NUM})(?![0-9.])(?!\\s*%)`, 'gi'))
  addMatches(new RegExp(`\\b(?:tp|target(?:\\s+level)?)\\s*\\d+\\s*[:=\\-]\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(
    new RegExp(
      `\\b(?:tp|take\\s*profit|target(?:\\s+level)?)(?:\\s*[:=\\-]\\s*|\\s+|\\.\\s*)(${SIGNAL_PRICE_NUM})(?![0-9.])(?!\\s*[:=\\-]\\s*${SIGNAL_PRICE_NUM})(?!\\s*%)`,
      'gi',
    ),
  )
  addMatches(new RegExp(`\\bentry\\s*(?:price|level)?\\s*[:=]\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\bentry\\s+level\\s*[:=]?\\s*(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`@\\s*(${SIGNAL_PRICE_NUM})`, 'g'))
  addMatches(new RegExp(`\\b(?:buy|sell)\\s+at\\s+(${SIGNAL_PRICE_NUM})`, 'gi'))
  addMatches(new RegExp(`\\bentry\\s+(${SIGNAL_PRICE_NUM})`, 'gi'))

  const addTwoPriceZone = (rx: RegExp) => {
    for (const m of text.matchAll(rx)) {
      const spanStart = m.index ?? 0
      const spanEnd = spanStart + m[0].length
      for (let i = 1; i <= 2; i++) {
        const value = parseSignalPriceToken(m[i])
        if (value == null) continue
        spans.push({ start: spanStart, end: spanEnd, value })
      }
    }
  }
  addTwoPriceZone(
    new RegExp(`\\b(?:between|from)\\s+(${SIGNAL_PRICE_NUM})\\s+(?:and|to|-|–)\\s+(${SIGNAL_PRICE_NUM})\\b`, 'gi'),
  )
  addTwoPriceZone(
    new RegExp(`\\b(?:now|instant|market|mkt)\\s+(${SIGNAL_PRICE_NUM})\\s*(?:-|–|to)\\s*(${SIGNAL_PRICE_NUM})\\b`, 'gi'),
  )

  // TP: 4557 / 4527 — each slash-separated value is labeled
  for (const m of text.matchAll(
    /\b(?:tp|take\s*profit|target(?:\s+level)?)\s*[:=]?\s*((?:\d+(?:\.\d+)?(?:\s*(?:\/|\band\b|\|)\s*)+)+\d+(?:\.\d+)?)/gi,
  )) {
    const block = m[1] ?? ''
    const base = m.index ?? 0
    const offset = m[0].indexOf(block)
    for (const value of parseSignalPriceListBlock(block.replace(/,/g, ''))) {
      const partStart = base + offset
      spans.push({ start: partStart, end: partStart + block.length, value })
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

  for (const m of text.matchAll(signalPriceTokenRegex())) {
    const raw = m[0]
    const index = m.index ?? 0
    if (isInsideSpan(index, raw.length, labeled)) continue
    if (isInsideParenthetical(index, text)) continue
    if (isPercentagePriceAt(text, index, raw.length)) continue
    if (isProviderSignalNumberToken(text, index, raw)) continue

    const prefix = text.slice(Math.max(0, index - 3), index)
    if (/[£$€]\s*$/.test(prefix)) continue
    const contextBefore = text.slice(Math.max(0, index - 28), index)
    if (
      /\b(?:profit|made|earned|gains?)\b/i.test(contextBefore)
      && !/\b(?:sl|tp|stop|take)\b/i.test(contextBefore)
    ) {
      continue
    }

    // Skip parenthetical duplicates: 4577 (4577.10)
    const after = text.slice(index + raw.length).trimStart()
    if (after.startsWith('(')) {
      const close = after.indexOf(')')
      if (close > 0) {
        const inner = after.slice(1, close).trim()
        if (new RegExp(`^${SIGNAL_PRICE_NUM}$`).test(inner)) continue
      }
    }

    const value = parseSignalPriceToken(raw)
    if (value == null || seen.has(value)) continue
    const digitsOnly = raw.replace(/,/g, '')
    if (/^\d{4}$/.test(digitsOnly)) {
      const year = Number(digitsOnly)
      if (year >= 1900 && year <= 2100) continue
    }
    seen.add(value)
    out.push(value)
  }

  return out
}

function priceTokenIntDigitLen(raw: string): number {
  const intPart = String(raw).replace(/,/g, '').trim().split('.')[0] ?? ''
  return intPart.length
}

/**
 * Expand channel shorthand entry zones like "4061-59" → 4059–4061 (second token drops leading digits).
 * `first` / `last` preserve text order (rawA then rawB) after any shorthand expansion.
 */
export function normalizeEntryZonePair(
  rawA: string,
  rawB: string,
): { low: number; high: number; first: number; last: number } | null {
  let first = parseSignalPriceToken(rawA)
  let last = parseSignalPriceToken(rawB)
  if (first == null || last == null) return null

  let lo = Math.min(first, last)
  let hi = Math.max(first, last)

  const rawFull = priceTokenIntDigitLen(rawA) >= priceTokenIntDigitLen(rawB) ? rawA : rawB
  const rawShort = priceTokenIntDigitLen(rawA) < priceTokenIntDigitLen(rawB) ? rawA : rawB
  const full = parseSignalPriceToken(rawFull)
  if (full == null) return { low: lo, high: hi, first, last }

  const shortInt = String(rawShort).replace(/,/g, '').trim().split('.')[0] ?? ''
  const fullStr = String(full).replace(/,/g, '')
  const [intFull, decFull] = fullStr.split('.')

  const span = hi - lo
  if (span > 20 && full >= 100 && shortInt.length > 0 && shortInt.length < intFull.length) {
    const prefix = intFull.slice(0, intFull.length - shortInt.length)
    const expandedInt = prefix + shortInt
    const expanded = parseSignalPriceToken(decFull ? `${expandedInt}.${decFull}` : expandedInt)
    if (expanded != null && Math.abs(expanded - full) < 500) {
      if (priceTokenIntDigitLen(rawA) >= priceTokenIntDigitLen(rawB)) {
        first = full
        last = expanded
      } else {
        first = expanded
        last = full
      }
      lo = Math.min(first, last)
      hi = Math.max(first, last)
    }
  }

  return { low: lo, high: hi, first, last }
}

function isPipOrRiskRangeMatch(text: string, start: number, matchLen: number): boolean {
  const after = text.slice(start + matchLen, start + matchLen + 16)
  const before = text.slice(Math.max(0, start - 28), start)
  if (/\bpips?\b/i.test(after)) return true
  if (/\brisk\b/i.test(before) && /\bpips?\b/i.test(after)) return true
  return false
}

/**
 * FX Culture / ICT style bare range on its own line: "4282.0-4287.0", "4282 / 4287".
 * Must appear as a two-price range, not a single labeled SL/TP value.
 */
export function extractBarePriceRangeZone(
  message: string,
): { low: number; high: number; first: number; last: number } | null {
  const collapsed = String(message ?? '').replace(/\s+/g, ' ').trim()
  const zoneRx = new RegExp(
    `(?:^|\\s)(${SIGNAL_PRICE_NUM})\\s*(?:-|–)\\s*(${SIGNAL_PRICE_NUM})(?:\\.|\\s|$)`,
    'gi',
  )
  for (const m of collapsed.matchAll(zoneRx)) {
    const start = m.index ?? 0
    if (isPipOrRiskRangeMatch(collapsed, start, m[0].length)) continue
    if (!m[1] || !m[2]) continue
    const zone = normalizeEntryZonePair(m[1], m[2])
    if (zone) return zone
  }
  return null
}

export type BuySellZonesBulletin = {
  side: TradeDirection
  symbol: string
  /** Ordered levels as written (deduped). */
  levels: number[]
  entry_zone_low: number
  entry_zone_high: number
  entry_zone_first: number
  entry_zone_last: number
}

const ZONES_HEADER_RE =
  /^\s*(?:#?\s*)?(GOLD|XAUUSD|XAU|SILVER|XAGUSD|XAG|BTC(?:USD|USDT)?|BITCOIN|ETH(?:USD|USDT)?|ETHEREUM|EURUSD|GBPUSD|USDJPY|US30|NAS100|NASDAQ|USTEC)\s+(BUY|SELL)S?\s+ZONES?\b/im

function zonesBulletinSymbol(raw: string): string {
  const t = String(raw ?? '').trim().toUpperCase()
  if (t === 'GOLD' || t === 'XAU') return 'XAUUSD'
  if (t === 'SILVER' || t === 'XAG') return 'XAGUSD'
  if (t === 'BITCOIN' || t === 'BTC') return 'BTCUSD'
  if (t === 'BTCUSDT') return 'BTCUSD'
  if (t === 'ETHEREUM' || t === 'ETH' || t === 'ETHUSDT') return 'ETHUSD'
  if (t === 'NASDAQ' || t === 'USTEC') return 'NAS100'
  return t
}

/** Collect bare price tokens from lines after a ZONES header (one level per line or slash-separated). */
function collectZonesBulletinLevels(body: string): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const cleaned = line.replace(/^[\s>*•\-–—]+/, '').trim()
    if (!cleaned) continue
    if (/^[A-Za-z]/.test(cleaned) && !new RegExp(`^${SIGNAL_PRICE_NUM}`).test(cleaned)) continue
    const fromList = parseSignalPriceListBlock(cleaned.replace(/,/g, ''))
    const candidates = fromList.length
      ? fromList
      : (() => {
          const single = parseSignalPriceToken(cleaned.replace(/,/g, ''))
          return single != null ? [single] : []
        })()
    for (const p of candidates) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * Gen Wealth / ICT style zone bulletins:
 *   GOLD SELL ZONES
 *   3866
 *   3874
 * Returns side + symbol + levels without inventing SL/TP.
 */
export function extractBuySellZonesBulletin(message: string): BuySellZonesBulletin | null {
  const raw = String(message ?? '').replace(/\r\n/g, '\n').trim()
  if (!raw) return null
  const header = raw.match(ZONES_HEADER_RE)
  if (!header?.[1] || !header?.[2]) return null
  const after = raw.slice((header.index ?? 0) + header[0].length)
  const levels = collectZonesBulletinLevels(after)
  if (levels.length < 1) return null
  const first = levels[0]!
  const last = levels[levels.length - 1]!
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  return {
    side: header[2].toLowerCase() === 'buy' ? 'buy' : 'sell',
    symbol: zonesBulletinSymbol(header[1]),
    levels,
    entry_zone_low: lo,
    entry_zone_high: hi,
    entry_zone_first: first,
    entry_zone_last: last,
  }
}

/** True when the message is a BUY/SELL ZONES bulletin (header present). */
export function looksLikeBuySellZonesBulletin(message: string): boolean {
  return ZONES_HEADER_RE.test(String(message ?? ''))
}

/**
 * Collapse a wide multi-level zone list to the nearest actionable level ± tolerance.
 * Two nearby levels (N&lt;3 and span ≤ maxSpanPips) keep min–max as the band.
 */
export function collapseZonesLevelsToWaitBand(args: {
  levels: number[]
  side: TradeDirection
  bid: number
  ask: number
  tolerancePips: number
  pipSize: number
  /** Span (in pips) above which we collapse even for 2 levels. Default 40. */
  maxSpanPips?: number
}): { zoneLo: number; zoneHi: number; level: number; collapsed: boolean } | null {
  const levels = uniquePrices(args.levels)
  if (!levels.length) return null
  const pip = Number(args.pipSize)
  const tolPips = Math.max(0, Number(args.tolerancePips ?? 0))
  const tolPx = tolPips > 0 && Number.isFinite(pip) && pip > 0 ? tolPips * pip : 0
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const spanPips = Number.isFinite(pip) && pip > 0 ? Math.abs(hi - lo) / pip : Infinity
  const maxSpan = Math.max(0, Number(args.maxSpanPips ?? 40))
  // Two listed levels always form one wait band. Collapse only for 3+ levels
  // (or an explicit maxSpan override with levels.length >= 3).
  const shouldCollapse = levels.length >= 3 || (levels.length > 3 && spanPips > maxSpan)
  if (!shouldCollapse) {
    return { zoneLo: lo, zoneHi: hi, level: levels.length === 1 ? lo : (lo + hi) / 2, collapsed: false }
  }

  const bid = Number(args.bid)
  const ask = Number(args.ask)
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    return { zoneLo: lo, zoneHi: hi, level: (lo + hi) / 2, collapsed: false }
  }

  let level: number
  if (args.side === 'buy') {
    const atOrBelow = levels.filter(p => p <= ask)
    if (atOrBelow.length) {
      level = Math.max(...atOrBelow)
    } else {
      level = Math.min(...levels)
    }
  } else {
    const atOrAbove = levels.filter(p => p >= bid)
    if (atOrAbove.length) {
      level = Math.min(...atOrAbove)
    } else {
      level = Math.max(...levels)
    }
  }
  const half = Math.max(tolPx, Number.isFinite(pip) && pip > 0 ? pip : 0)
  return {
    zoneLo: level - half,
    zoneHi: level + half,
    level,
    collapsed: true,
  }
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
