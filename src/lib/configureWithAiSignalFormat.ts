/**
 * Fingerprint a signal sample by *format shape*, not concrete prices,
 * so Configure with AI keeps one example per distinct layout.
 * Also classify entry vs management (modify/close) from raw text.
 */

export type ConfigureSignalSampleLabel = 'entry' | 'update' | 'ignore'

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase()
}

/** Replace numbers / prices so "buy 4059" and "buy 4102" share a format. */
export function scrubSignalFormatBody(raw: string): string {
  let t = normalizeWhitespace(raw)
  // JSON-ish: collapse quoted numbers and bare numbers after colons
  t = t.replace(/:\s*"-?\d+(?:\.\d+)?"/g, ':"#"')
  t = t.replace(/:\s*-?\d+(?:\.\d+)?/g, ':#')
  // Ranges like 4059.6 - 4055 or 4059/4055
  t = t.replace(/\d+(?:\.\d+)?\s*[-–—/]\s*\d+(?:\.\d+)?/g, '#-#')
  // Standalone prices / lots / percents
  t = t.replace(/\b\d+(?:\.\d+)?%?\b/g, '#')
  // Collapse repeated scrubbed tokens
  t = t.replace(/(?:#\s*){3,}/g, '# # #')
  return t
}

function intentShapeKey(intent: Record<string, unknown> | undefined, label?: string): string {
  if (!intent || typeof intent !== 'object') {
    return `label:${String(label ?? 'entry').toLowerCase()}`
  }
  const kind = String(intent.kind ?? 'ignore').toLowerCase()
  const side = intent.side ? 'side' : 'noside'
  const entry = Array.isArray(intent.entry) ? intent.entry.length : 0
  const tp = Array.isArray(intent.tp) ? intent.tp.length : 0
  const sl = intent.sl != null && Number(intent.sl) > 0 ? 'sl' : 'nosl'
  const openTp = intent.open_tp === true ? 'open_tp' : 'no_open_tp'
  const lbl = String(label ?? kind).toLowerCase()
  // Bucket entry depth / TP depth so small count differences still distinguish formats
  const entryBucket = entry === 0 ? '0' : entry === 1 ? '1' : 'zone'
  const tpBucket = tp === 0 ? '0' : tp === 1 ? '1' : tp <= 3 ? '2-3' : '4+'
  return `label:${lbl}|kind:${kind}|${side}|entry:${entryBucket}|tp:${tpBucket}|${sl}|${openTp}`
}

/**
 * Stable key for "same signal format" (teaser vs priced entry vs multi-TP params, etc.).
 */
export function signalFormatFingerprint(sample: {
  raw_message: string
  label?: string
  intent?: Record<string, unknown>
}): string {
  const body = scrubSignalFormatBody(sample.raw_message ?? '')
  const shape = intentShapeKey(sample.intent, sample.label)
  // Keep a short body hash of scrubbed text so layout words (sl:/tp:/buy now) matter
  const compact = body.replace(/\s+/g, ' ').slice(0, 280)
  return `${shape}::${compact}`
}

/**
 * Classify channel message as entry vs management update from raw text.
 * Used when parsed_data / is_modification is missing or wrong (e.g. Telegram backfill).
 */
export function classifyConfigureSignalLabel(raw: string): ConfigureSignalSampleLabel {
  const t = normalizeWhitespace(raw)
  if (!t) return 'ignore'

  // Management / modify / close first (must beat "buy/sell" tokens that sometimes appear)
  if (
    /\b(?:close\s+half|close\s+all|close\s+\d+%|partial\s+close|take\s+\d+%|book\s+profit|secure\s+profit)\b/.test(t) ||
    /\bclose\b/.test(t) && !/\b(?:buy|sell)\s+now\b/.test(t)
  ) {
    return 'update'
  }
  if (
    /\b(?:move|set|modify|change|adjust|update)\s+(?:sl|tp|tp\s*\d+|stop(?:\s*loss)?|take\s*profit)\b/.test(t) ||
    /\b(?:sl|tp|tp\s*\d+|stop(?:\s*loss)?)\s+(?:to|@|=)\b/.test(t) ||
    /\b(?:move|set)\s+stop\b/.test(t) ||
    /\b(?:breakeven|break\s*even|sl\s+to\s+entry|be\b)\b/.test(t) ||
    /\b(?:trailing|trail\s+sl)\b/.test(t)
  ) {
    return 'update'
  }

  if (
    /\b(?:buy|sell)\s+now\b/.test(t) ||
    /\b(?:buy|sell)\b/.test(t) ||
    /\bentry\b/.test(t)
  ) {
    return 'entry'
  }

  return 'ignore'
}

export function inferConfigureSignalIntent(
  raw: string,
  label: ConfigureSignalSampleLabel,
): Record<string, unknown> {
  const t = normalizeWhitespace(raw)
  const side = /\bsell\b/.test(t) ? 'SELL' : /\bbuy\b/.test(t) ? 'BUY' : null
  if (label === 'entry') {
    return {
      kind: 'entry',
      side,
      symbol: null,
      entry: [],
      sl: null,
      tp: [],
    }
  }
  if (label !== 'update') {
    return { kind: 'ignore', side: null, symbol: null, entry: [], sl: null, tp: [] }
  }
  if (/\bclose\s+half\b|\bpartial\s+close\b|\btake\s+\d+%\b|\bclose\s+\d+%\b/.test(t)) {
    return { kind: 'partial_close', side, symbol: null, entry: [], sl: null, tp: [] }
  }
  if (/\bclose\b/.test(t)) {
    return { kind: 'close', side, symbol: null, entry: [], sl: null, tp: [] }
  }
  if (/\bbreakeven|break\s*even|sl\s+to\s+entry|\bbe\b/.test(t)) {
    return { kind: 'breakeven', side, symbol: null, entry: [], sl: null, tp: [] }
  }
  return { kind: 'modify', side, symbol: null, entry: [], sl: null, tp: [] }
}
