/**
 * Strict instrument detection for Telegram signals.
 * Forex pairs, metals, crypto, indices, US stocks/ETFs, and Deriv synthetics —
 * not arbitrary 6-letter words.
 */

import { isDerivSyntheticSymbol, normalizeDerivAlias } from "./derivSymbols.ts"

const FX_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD",
  "SEK", "NOK", "DKK", "ZAR", "MXN", "SGD", "HKD", "TRY",
  "PLN", "HUF", "CZK", "ILS", "RUB", "KRW", "CNH", "CNY",
  "INR", "BRL", "THB",
])

const METAL_PREFIXES = ["XAU", "XAG", "XPT", "XPD"]

const CRYPTO_TOKENS = new Set([
  "BTC", "ETH", "LTC", "XRP", "ADA", "DOT", "DOGE", "SOL",
  "BNB", "AVAX", "MATIC", "LINK", "TRX", "XLM", "BCH", "EOS",
  "ATOM", "NEAR", "FTM", "ALGO", "USDT", "USDC",
])

const CRYPTO_QUOTES = new Set(["USD", "USDT", "USDC", "EUR", "BTC", "ETH"])

const INDEX_ROOTS = [
  "US30", "US500", "US100", "USTEC", "NAS100", "NAS", "SPX", "SPX500", "DJI", "DJ30",
  "UK100", "FTSE", "GER40", "DE40", "DAX", "EU50", "STOXX", "STX",
  "JPN225", "JP225", "NIKKEI", "NIK", "HK50", "HSI", "AUS200", "AU200",
  "F40", "FRA40", "SPA35", "IBEX", "NETH25", "SWI20", "SMI",
  "CHINA50", "CHN50", "INDIA50",
]

const EXPLICIT_SYMBOLS = new Set([
  "BTCUSD", "BTCUSDT", "BTCEUR", "ETHUSD", "ETHUSDT", "EURUSD", "GBPUSD", "USDJPY",
  "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY",
  "XAUUSD", "XAGUSD", "US30", "US500", "US100", "NAS100", "GER40", "UK100", "SPX500", "USTEC",
])

/** Curated US equities/ETFs commonly signaled (ForexBro "Market: QQQ · BUY" and similar). */
export const US_STOCK_ETF_TICKERS = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VOO", "IVV", "TQQQ", "SQQQ", "GLD", "SLV",
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "GOOG", "AMD", "NFLX",
])

const MARKET_LINE_REJECT = new Set([
  "BUY", "SELL", "LONG", "SHORT", "NOW", "USD", "EUR", "GBP", "JPY", "AUD", "CAD",
  "CHF", "NZD", "THE", "NEW", "ALL", "FOR", "AND", "NOT", "OUT", "TOP", "SL", "TP",
])

export type TradableInstrumentClass =
  | "forex"
  | "metal"
  | "crypto"
  | "index"
  | "stock"
  | "deriv_synthetic"

export function isUsStockEtfTicker(symbol: string): boolean {
  const s = cleanInstrumentSymbol(symbol)
  return s.length >= 1 && s.length <= 5 && US_STOCK_ETF_TICKERS.has(s)
}

/** ForexBro template: "Market: QQQ · BUY" */
export function extractMarketLineSymbol(raw: string): string | null {
  const m = String(raw ?? "").match(
    /\bmarket\s*:\s*([A-Za-z]{1,12})\s*[·•|]/i,
  )
  if (!m?.[1]) return null
  const ticker = cleanInstrumentSymbol(m[1])
  if (!ticker || ticker.length > 5) return null
  if (MARKET_LINE_REJECT.has(ticker)) return null
  if (US_STOCK_ETF_TICKERS.has(ticker)) return ticker
  if (/^[A-Z]{1,5}$/.test(ticker)) return ticker
  return null
}

export function cleanInstrumentSymbol(symbol: string): string {
  const upper = String(symbol || "").toUpperCase().trim()
  if (!upper) return ""
  if (isDerivSyntheticSymbol(upper)) return upper
  const punctMatch = upper.match(/^([A-Z0-9]+)[.#_-]/)
  let core = punctMatch ? punctMatch[1] : upper
  if (core.length === 7 && /^[A-Z]{6}[A-Z]$/.test(core)) {
    const base = core.slice(0, 6)
    const b = base.slice(0, 3)
    const q = base.slice(3, 6)
    if (FX_CURRENCY_CODES.has(b) && FX_CURRENCY_CODES.has(q)) {
      return base
    }
  }
  return core
}

export function classifyTradableInstrument(symbol: string): TradableInstrumentClass | null {
  const s = cleanInstrumentSymbol(symbol)
  if (!s || s.length > 12) return null
  if (isUsStockEtfTicker(s)) return "stock"
  if (s.length < 3) return null
  if (isDerivSyntheticSymbol(s)) return "deriv_synthetic"
  if (EXPLICIT_SYMBOLS.has(s)) {
    if (s.startsWith("XAU") || s.startsWith("XAG") || s.startsWith("XPT") || s.startsWith("XPD")) {
      return "metal"
    }
    for (const tok of CRYPTO_TOKENS) {
      if (s.startsWith(tok) || s.endsWith(tok)) return "crypto"
    }
    for (const root of INDEX_ROOTS) {
      if (s.includes(root)) return "index"
    }
    return "forex"
  }

  for (const p of METAL_PREFIXES) {
    if (s.startsWith(p)) return "metal"
  }

  for (const root of INDEX_ROOTS) {
    if (s.includes(root)) return "index"
  }

  if (/^(US|DE|UK|AU|JP|HK|EU|FR|ES|CH|CN|IN)\d{2,4}$/.test(s)) return "index"
  if (/^(NAS|SPX|DJ|DAX|FTSE|NIK|HSI|STOXX)\d{0,4}$/i.test(s) && /\d/.test(s)) return "index"

  for (const base of CRYPTO_TOKENS) {
    if (base === "USDT" || base === "USDC") continue
    if (!s.startsWith(base) || s.length <= base.length) continue
    const quote = s.slice(base.length)
    if (CRYPTO_QUOTES.has(quote)) return "crypto"
  }

  if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
    const base = s.slice(0, 3)
    const quote = s.slice(3, 6)
    if (FX_CURRENCY_CODES.has(base) && FX_CURRENCY_CODES.has(quote)) return "forex"
  }

  return null
}

export function isTradableInstrumentSymbol(symbol: string): boolean {
  return classifyTradableInstrument(symbol) != null
}

export function hasTradableInstrumentInText(text: string): boolean {
  return extractTradableSymbolFromMessage(text) != null
}

export function extractTradableSymbolFromMessage(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null
  const u = raw.toUpperCase().replace(/\s+/g, " ")

  const marketLine = extractMarketLineSymbol(raw)
  if (marketLine) return marketLine

  const slash = raw.match(/\b([A-Z]{3,})\s*\/\s*([A-Z]{3,})\b/i)
  if (slash) {
    const combined = cleanInstrumentSymbol(slash[1] + slash[2])
    if (isTradableInstrumentSymbol(combined)) return combined
  }

  const onFor = raw.match(
    /\b(?:on|for)\s+([A-Za-z][A-Za-z0-9./]{2,20})\b/i,
  )
  if (onFor?.[1]) {
    const sub = onFor[1].trim()
    const subUp = sub.toUpperCase()
    if (/\b(GOLD|XAU)\b/.test(subUp)) return "XAUUSD"
    if (/\b(SILVER|XAG)\b/.test(subUp)) return "XAGUSD"
    if (/\b(BITCOIN|BTC)\b/.test(subUp)) return /\bUSDT\b/i.test(sub) ? "BTCUSDT" : "BTCUSD"
    const slashOn = sub.match(/^([A-Za-z]{3,})\s*\/\s*([A-Za-z]{3,})$/i)
    if (slashOn) {
      const combined = cleanInstrumentSymbol(slashOn[1] + slashOn[2])
      if (isTradableInstrumentSymbol(combined)) return combined
    }
    const sym = cleanInstrumentSymbol(sub.replace(/\s+/g, ""))
    if (isTradableInstrumentSymbol(sym)) return sym
  }

  const explicit = u.match(
    /\b(BTCUSDT|BTCEUR|BTCUSD|ETHUSDT|ETHUSD|EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCAD|USDCHF|XAUUSD|XAGUSD|NAS100|SPX500|USTEC|US100|US500|US30|GER40|UK100|DJ30|DJI|DAX40|JP225|JPN225|AUS200|HK50|EU50|FRA40|DE40|CHN50|CN50|SPY|QQQ|IWM|DIA|VOO|IVV|TQQQ|GLD|SLV|AAPL|MSFT|NVDA|TSLA|AMZN|META|GOOGL|GOOG|AMD|NFLX)\b/,
  )
  if (explicit) {
    const sym = cleanInstrumentSymbol(explicit[1])
    if (isTradableInstrumentSymbol(sym)) return sym
  }

  if (/\bBITCOIN\b|\bBTC\b/.test(u) && /\bEUR\b/.test(u) && !/\bUSD\b|\bUSDT\b|\bPERP\b/.test(u)) {
    return "BTCEUR"
  }
  if (/\bBITCOIN\b|\bBTC\b/.test(u)) return /\bUSDT\b/.test(u) ? "BTCUSDT" : "BTCUSD"
  if (/\bETHER(EUM)?\b|\bETH\b/.test(u)) return /\bUSDT\b/.test(u) ? "ETHUSDT" : "ETHUSD"
  if (/\b(XAUUSD|XAU\b|GOLD)\b/.test(u)) return "XAUUSD"
  if (/\bSILVER\b|\bXAG\b|\bXAGUSD\b/.test(u)) return "XAGUSD"

  const deriv = normalizeDerivAlias(raw)
  if (deriv) return deriv

  const tokens = u.match(/\b[A-Z][A-Z0-9]{2,11}\b/g) ?? []
  const seen = new Set<string>()
  for (const tok of [...tokens].sort((a, b) => b.length - a.length)) {
    const cleaned = cleanInstrumentSymbol(tok)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    if (isTradableInstrumentSymbol(cleaned)) return cleaned
  }

  return null
}

export function sanitizeParsedSymbol(symbol: string | null | undefined): string | null {
  if (symbol == null || !String(symbol).trim()) return null
  const cleaned = cleanInstrumentSymbol(String(symbol).trim())
  if (isTradableInstrumentSymbol(cleaned)) return cleaned
  return normalizeDerivAlias(String(symbol).trim())
}

export function minPlausibleQuotePrice(symbol: string | null | undefined): number | null {
  const s = sanitizeParsedSymbol(symbol ?? null)
  if (!s) return null
  if (s === "XAUUSD" || s.startsWith("XAU")) return 500
  if (s === "XAGUSD" || s.startsWith("XAG")) return 5
  if (s.startsWith("BTC")) return 1000
  if (s.startsWith("ETH")) return 50
  const cls = classifyTradableInstrument(s)
  if (cls === "deriv_synthetic") {
    return /^STPRNG/.test(s) ? 1000 : 100
  }
  if (cls === "forex") return 0.01
  if (cls === "index") return 100
  if (cls === "stock") return 1
  return null
}

export function filterPlausibleInstrumentPrices(
  symbol: string | null | undefined,
  prices: number[],
): number[] {
  const min = minPlausibleQuotePrice(symbol)
  if (min == null) return prices
  return prices.filter((p) => Number.isFinite(p) && p >= min)
}
