/**
 * Regex-first parsing for Telegram trade messages (runs before LLM).
 */

export interface FastpathParsed {
  action: string
  symbol: string | null
  entry_price: number | null
  entry_zone_low: number | null
  entry_zone_high: number | null
  sl: number | null
  tp: number[]
  lot_size: number | null
  confidence: number
  raw_instruction: string
}

const NUM_CHUNK = "(\\d+(?:[.,]\\d+)?)"

function normalizeNumToken(raw: string): number | null {
  const n = Number(raw.replace(",", ""))
  return Number.isFinite(n) ? n : null
}

/** Extract TP levels including TP @ N, emoji TP lines, target/tgt. */
export function extractTpLevelsFromText(t: string): number[] {
  const seen = new Set<number>()
  const push = (raw: string | undefined) => {
    if (!raw) return
    const n = normalizeNumToken(raw)
    if (n != null) seen.add(n)
  }
  const linePatterns = [
    /\b(?:tp\d*|take\s*profit|tgt|target)\s*[:=@#]?\s*([\d.,]+)/gi,
    /\b(?:tp\d*|take\s*profit)\s+@\s*([\d.,]+)/gi,
    /(?:🤑|🎯)\s*(?:tp\d*)?\s*[:=@]?\s*([\d.,]+)/gi,
  ]
  for (const re of linePatterns) {
    for (const m of t.matchAll(re)) push(m[1])
  }
  return Array.from(seen)
}

/** First SL level for management messages. */
export function extractSlFromText(t: string): number | null {
  const patterns = [
    new RegExp(`\\b(?:sl|stop\\s*loss)\\s*[:=@]?\\s*${NUM_CHUNK}`, "i"),
    new RegExp(`\\b(?:sl|stop\\s*loss)\\s*[:=#]?\\s*(?:to|at)\\s*${NUM_CHUNK}`, "i"),
    new RegExp(`\\badjust\\s+(?:the\\s+)?(?:sl|stop\\s*loss)\\s+(?:to|at|=|@)\\s*${NUM_CHUNK}`, "i"),
    new RegExp(`\\bmove\\s+(?:the\\s+)?(?:sl|stop\\s*loss)\\s+(?:to|at|=|@)\\s*${NUM_CHUNK}`, "i"),
    new RegExp(`\\bset\\s+(?:the\\s+)?(?:sl|stop\\s*loss)\\s+(?:to|at|=|@)\\s*${NUM_CHUNK}`, "i"),
    new RegExp(`🔴\\s*(?:sl|stop\\s*)?[:=@]?\\s*${NUM_CHUNK}`, "i"),
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m?.[1]) {
      const n = normalizeNumToken(m[1])
      if (n != null) return n
    }
  }
  return null
}

export function extractTradableSymbolFromMessage(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null
  const u = raw.toUpperCase().replace(/\s+/g, " ")

  const slash = raw.match(/\b([A-Z]{3,})\s*\/\s*([A-Z]{3,})\b/i)
  if (slash) return (slash[1] + slash[2]).toUpperCase()

  const explicit = u.match(
    /\b(BTCUSD|BTCUSDT|BTCEUR|ETHUSD|ETHUSDT|EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCAD|USDCHF|XAUUSD|XAGUSD|US30|US500|NAS100|GER40|UK100|SPX500|USTEC)\b/,
  )
  if (explicit) return explicit[1]

  if (/\bBITCOIN\b|\bBTC\b/.test(u) && /\bEUR\b/.test(u) && !/\bUSD\b|\bUSDT\b|\bPERP\b/.test(u)) return "BTCEUR"
  if (/\bBITCOIN\b|\bBTC\b/.test(u)) return /\bUSDT\b/.test(u) ? "BTCUSDT" : "BTCUSD"
  if (/\bETHER(EUM)?\b|\bETH\b/.test(u)) return /\bUSDT\b/.test(u) ? "ETHUSDT" : "ETHUSD"
  if (/\b(XAUUSD|XAU\b|GOLD)\b/.test(u)) return "XAUUSD"
  if (/\bSILVER\b|\bXAG\b|\bXAGUSD\b/.test(u)) return "XAGUSD"

  const bogusSix = new Set([
    "CLOSED", "CLOSES", "SIGNAL", "MARKET", "SILVER", "GOLDEN", "MASTER", "PUBLIC", "TRADER", "BROKER",
    "MARGIN", "POSITION", "TRADES", "ORDERS",
  ])
  const six = u.match(/\b([A-Z]{6})\b/)
  if (six && !bogusSix.has(six[1])) {
    return six[1]
  }
  return null
}

const ENTRY_KW = /\b(buy|sell|long|short)\b/i

/** Aggressive close intent (narrow false positives handled below). */
function isCloseIntent(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim()
  if (!s) return false
  const sl = s.toLowerCase()
  if (/\bflatten\b|\bkill\s*zones?\b/i.test(s)) return true
  if (/\bexit\s+(?:the\s+)?(?:trade|position|long|short)\b/i.test(sl)) return true
  // close all, close all now, close everything
  if (/\bclose\s+all\b/i.test(sl)) return true
  if (/\bclose\s+all\s+(?:trades?|positions?|orders?)(?:\s+now)?\b/i.test(sl)) return true
  if (/\bclose\s+every\s*thing\b/i.test(sl)) return true
  // close now / close immediately
  if (/\bclose\s+now\b/i.test(sl)) return true
  if (/\bclose\s+immediately\b/i.test(sl)) return true
  // close SYMBOL trade|position
  if (/\b(?:close|closing)\s+[A-Z0-9]{4,}\s+(?:the\s+)?(?:trade|position|order)s?\b/i.test(s)) return true
  // close (my|the|...) (open|active)? trade
  if (
    /\b(?:close|closed|closing)\s+(?:(?:my|the|this|our)\s+)?(?:(?:running|active|open)\s+)?(?:trade|position|order)s?\b/i
      .test(sl)
  ) return true
  // close gold / close btc (no "trade" word)
  if (/\b(?:close|closing)\s+(?:gold|silver|xau|xag|btc|bitcoin|eth|ethereum)\b/i.test(sl)) return true
  // legacy: close + optional "all" as single token after close
  if (/\bclose\s+all\s*$/i.test(sl)) return true
  return false
}

function isModifyIntent(t: string): boolean {
  if (
    /\b(set|move|adjust|bring|update|change)\s+(?:the\s+)?(sl|tp|stop\s*loss|take\s*profit)\b/i.test(t)
  ) return true
  if (/\b(?:tp\d*|take\s*profit)\s*[@=:]\s*[\d.,]+/i.test(t)) return true
  if (/\b(?:sl|stop\s*loss)\s*[@=:]\s*[\d.,]+/i.test(t)) return true
  if (/\b(?:stop\s*loss|take\s*profit)\s+(?:to|at|=|@)\s*[\d.,]+/i.test(t)) return true
  if (/\badjust\s+(?:the\s+)?(?:sl|stop\s*loss|tp|take\s*profit)\b/i.test(t)) return true
  return false
}

/**
 * New entry cards: BUY/SELL + instrument + SL/TP lines often matched `modify` incorrectly.
 * Run this before classify-as-modify in parseDeterministicManagement.
 */
function tryStructuredEntry(t: string, tl: string): FastpathParsed | null {
  if (isCloseIntent(t)) return null
  // Handled elsewhere in the caller
  if (/\bpartial\b|\bc\s*half\b|close\s+50%|close\s+half\b|secure\s+\d+\s*%/i.test(t)) return null
  if (
    /\bbreakeven|break\s*even\b/i.test(t) || /\bmoved?\s+(sl\s+)?to\s+(be|entry|entr(y)?\s?price)|\b(be|bk)\s*now\b/i.test(t)
  ) return null

  const isBuy = /\b(buy|long)\b/i.test(t)
  const isSell = /\b(sell|short)\b/i.test(t)
  if (!isBuy && !isSell) return null
  if (isBuy && isSell) return null

  const sym = extractTradableSymbolFromMessage(t)
  if (!sym) return null

  // Pure management line (no explicit entry side intent in the snippet)
  const trimmedStart = t.replace(/^\uFEFF?\s+/u, "").trimStart()
  if (
    /^(set|move|adjust|update|change)\s+(?:the\s+)?(?:sl|tp|stop\s*loss|take\s*profit)\b/i.test(trimmedStart) ||
    /^(tp\d*|sl|stop\s*loss)\s*[@:=]/i.test(trimmedStart)
  ) return null

  const hasInstant = /\b(now|instant|market|mkt\b|signal\s*alert|at\s+market|@\s*market)\b/i.test(tl)

  const sl = extractSlFromText(t)
  const tp = extractTpLevelsFromText(t)
  const hasLevels = sl != null || tp.length > 0

  if (!hasInstant && !hasLevels) return null

  return {
    action: isBuy ? "buy" : "sell",
    symbol: sym,
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl,
    tp,
    lot_size: null,
    confidence: 0.95,
    raw_instruction: t,
  }
}

export function parseDeterministicManagement(message: string): FastpathParsed | null {
  const t = message.replace(/\s+/g, " ").trim()
  if (!t) return null
  const tl = t.toLowerCase()

  const sym = extractTradableSymbolFromMessage(t)
  let action: FastpathParsed["action"] | null = null
  let confidence = 0.92

  // Partial / BE / modify before broad "close" so phrases like "close half gold" stay partial_profit.
  if (
    /\bpartial\b|\bc\s*half\b|close\s+50%|close\s+half\b|secure\s+\d+\s*%|half\s+position/i.test(t)
  ) action = "partial_profit"
  else if (
    /\bbreakeven|break\s*even\b/i.test(t) || /\bmoved?\s+(sl\s+)?to\s+(be|entry|entr(y)?\s?price)|\b(be|bk)\s*now\b/i.test(t)
  ) {
    action = "breakeven"
  } else {
    const entryParsed = tryStructuredEntry(t, tl)
    if (entryParsed) return entryParsed
  }

  if (!action) {
    if (isModifyIntent(t)) action = "modify"
    else if (isCloseIntent(t)) action = "close"
  }

  if (!action) return null

  const looksEntry = ENTRY_KW.test(t) &&
    /\b(buy|sell)\s+(now|btc|bitcoin|gold|xau)|market\s+(buy|sell)/i.test(t)
  if (action === "close" && /\b(stop\s*sell|sell\s*stops?)\s+now\b/i.test(tl)) return null

  if (action === "close" && looksEntry && /\b(and|&)+\s*(gold|btc)\b/i.test(tl)) {
    confidence = 0.88
  }

  const sl = extractSlFromText(t)
  const tp = extractTpLevelsFromText(t)

  return {
    action,
    symbol: sym,
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl,
    tp,
    lot_size: null,
    confidence,
    raw_instruction: message,
  }
}

export function parseSimpleSignal(message: string): FastpathParsed | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim()
  if (!text) return null

  if (/\b(close|flatten|exit\s+trade|breakeven|break\s+even|partial|move\s+(sl|tp)|adjust\s+(sl|tp|stop|take))\b/i.test(text)) {
    return null
  }

  const isBuy = /\b(buy|long)\b/.test(text)
  const isSell = /\b(sell|short)\b/.test(text)
  const isNow = /\b(now|instant|market|mkt\b)\b/.test(text)
  const atMarketLike = /\b(at\s+market|@\s*market)\b/i.test(message)

  if (!isNow && !atMarketLike) return null
  if (isBuy === isSell) return null

  const instrument = extractTradableSymbolFromMessage(message)
  if (!instrument) return null

  const hasInstrumentContext =
    /\b(gold|xau|xauusd|btc|bitcoin|btcusd|btcusdt|eth|ethereum|silver|eur|gbp)\b/i.test(text) ||
    /\bEUR\/USD|EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSD|BTCUSDT\b/i.test(message) ||
    /\b(us30|nas100|ger40|uk100|ustec|spx500)\b/i.test(text) ||
    /^[A-Z]{4,}$/i.test(instrument.trim())

  if (!hasInstrumentContext) return null

  const sl = extractSlFromText(message)
  const tp = extractTpLevelsFromText(message)

  return {
    action: isBuy ? "buy" : "sell",
    symbol: instrument,
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl,
    tp,
    lot_size: null,
    confidence: 0.99,
    raw_instruction: message,
  }
}
