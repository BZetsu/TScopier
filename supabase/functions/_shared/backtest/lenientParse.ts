import { extractTradableSymbolFromMessage } from "../tradableSymbol.ts"

/** Backtest-only parser for common Telegram signal layouts (runs before OpenAI). */
export function lenientParseTradeMessage(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim()
  if (!text) return null

  if (/\b(close\s+all|breakeven|partial\s+profit|move\s+sl|update\s+sl)\b/i.test(text)) {
    return null
  }

  const buy = /\b(buy|long)\b/i.test(text)
  const sell = /\b(sell|short)\b/i.test(text)
  if (buy === sell) return null
  const action = buy ? "buy" : "sell"

  const symbol = extractTradableSymbolFromMessage(raw)
  if (!symbol) return null

  let sl = extractLabeledPrice(raw, [
    "sl", "s/l", "s.l", "stop loss", "stoploss", "stop",
  ])
  let tp = extractTpPrices(raw)
  let entry =
    extractLabeledPrice(raw, ["entry", "enter", "price", "ep", "at", "@"]) ??
    extractLabeledPrice(raw, ["buy", "sell", "long", "short"])

  if (sl == null || tp.length === 0) {
    const inferred = inferPricesFromNumberLines(raw, action)
    if (inferred) {
      if (sl == null) sl = inferred.sl
      if (tp.length === 0 && inferred.tps.length) {
        tp = [...inferred.tps]
      }
      if (entry == null && inferred.entry != null) entry = inferred.entry
    }
  }

  if (sl == null && tp.length === 0) return null

  return {
    action,
    symbol,
    entry_price: entry != null && entry > 0 ? entry : null,
    sl,
    tp,
    confidence: 0.88,
    raw_instruction: raw,
    parse_source: "lenient",
  }
}

function extractLabeledPrice(raw: string, labels: string[]): number | null {
  for (const label of labels) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")
    const rx = new RegExp(
      `(?:^|\\n|\\s)${esc}\\s*[:#\\-]?\\s*@?\\s*(\\d+(?:\\.\\d+)?)`,
      "im",
    )
    const m = raw.match(rx)
    if (m?.[1]) {
      const n = Number(m[1])
      if (Number.isFinite(n) && isPlausiblePrice(n)) return n
    }
  }
  return null
}

function extractTpPrices(raw: string): number[] {
  const out: number[] = []
  const patterns = [
    /\b(?:tp|t\.p|target|take\s*profit)\s*\d*\s*[:#\-]?\s*@?\s*(\d+(?:\.\d+)?)/gi,
    /\bTP\s*\d+\s*[:#\-]?\s*(\d+(?:\.\d+)?)/gi,
  ]
  for (const rx of patterns) {
    for (const m of raw.matchAll(rx)) {
      const n = Number(m[1])
      if (Number.isFinite(n) && isPlausiblePrice(n)) out.push(n)
    }
  }
  return [...new Set(out)]
}

function isPlausiblePrice(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false
  if (n >= 2020 && n <= 2035 && Number.isInteger(n)) return false
  return n >= 0.01 && n < 1_000_000
}

function inferPricesFromNumberLines(
  raw: string,
  action: "buy" | "sell",
): { entry: number | null; sl: number | null; tps: number[] } | null {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const linePrices: number[] = []

  for (const line of lines) {
    if (/\b(20\d{2}|19\d{2})\b/.test(line) && /\d{1,2}[\/\-.]\d{1,2}/.test(line)) continue
    if (/\b(buy|sell|long|short|signal|gold|xau|eur|gbp|btc)\b/i.test(line) && !/\d{3,}/.test(line)) {
      continue
    }
    const nums = [...line.matchAll(/(\d{2,5}(?:\.\d+)?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => isPlausiblePrice(n))
    if (nums.length === 1) linePrices.push(nums[0]!)
    else if (nums.length > 1) linePrices.push(...nums)
  }

  const unique = [...new Set(linePrices)]
  if (unique.length < 2) return null

  if (unique.length === 2) {
    const [a, b] = unique
    if (action === "buy") {
      return { entry: null, sl: Math.min(a, b), tps: [Math.max(a, b)] }
    }
    return { entry: null, sl: Math.max(a, b), tps: [Math.min(a, b)] }
  }

  const sorted = [...unique].sort((x, y) => x - y)
  const entry = sorted[Math.floor(sorted.length / 2)] ?? null
  const sl = action === "buy" ? sorted[0]! : sorted[sorted.length - 1]!
  const tps = action === "buy"
    ? sorted.filter((p) => p > (entry ?? sl))
    : sorted.filter((p) => p < (entry ?? sl))

  return {
    entry,
    sl,
    tps: tps.length ? tps : [sorted[action === "buy" ? sorted.length - 1 : 0]!],
  }
}
