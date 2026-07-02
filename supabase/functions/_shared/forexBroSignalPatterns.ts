/**
 * ForexBro Elite Signals — bilingual template detection (entry + management).
 */
import { parseSignalPriceToken, SIGNAL_PRICE_NUM } from "./signalPriceFormat.ts"

export type ForexBroParseResult = {
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
  open_tp: boolean
  provider_signal_number?: number | null
  skip_reason?: string
}

export function extractProviderSignalNumber(message: string): number | null {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  const m = t.match(
    /\b(?:new\s+signal|signal|صفقة\s+(?:رقم|حديثة))\s*#\s*(\d{1,6})\b/i,
  )
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function looksLikeForexBroSlTrailUpdate(message: string): boolean {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!t) return false
  if (/\btp\s*\d+\s*:?\s*done\b/i.test(t) && extractForexBroTrailSlPrice(t) != null) return true
  if (/جني\s+الأرباح\s+(?:الأول|الثاني|الثالث)\s*:\s*نجاح/i.test(t) && extractForexBroTrailSlPrice(t) != null) {
    return true
  }
  return false
}

export function looksLikeForexBroTpCompleteNotice(message: string): boolean {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!t) return false
  const tp3Done = /\btp\s*3\s*:?\s*done\b/i.test(t) || /الهدف\s+الثالث\s*:?\s*نجاح/i.test(t)
  const allTargets = /\ball\s+targets\b/i.test(t) && /\bachieved\b/i.test(t)
  const hasSlVerb = /\b(?:modify|move|adjust|set|update)\b.*\b(?:stop[- ]?loss|sl)\b/i.test(t)
    || /عدّ?ل\s+وقف\s+الخسارة/i.test(t)
  return tp3Done && allTargets && !hasSlVerb
}

export function looksLikeForexBroPostFactoBreakeven(message: string): boolean {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!t) return false
  const header = /\b(?:break[- ]?even|تعادل)\b.*\b(?:no\s+loss|بلا\s+خسارة)\b/i.test(t)
    || /\bتعادل\s*—\s*بلا\s+خسارة\b/i.test(t)
  const pastTense = /\b(?:was\s+moved|closed\s+at\s+break[- ]?even|trade\s+closed)\b/i.test(t)
    || /\b(?:نُقل|أُغلقت|عاد\s+السعر)\b/.test(t)
  return header && pastTense
}

export function looksLikeForexBroLockProfitAlert(message: string): boolean {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!t) return false
  return /\block[- ]?profit\s+alert\b/i.test(t) || /\bتنبيه\s+تأمين\s+الربح\b/i.test(t)
}

export function extractForexBroTrailSlPrice(message: string): number | null {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  const patterns = [
    new RegExp(`\\bmodify\\s+(?:your\\s+)?stop[- ]?loss\\s+to\\s+(${SIGNAL_PRICE_NUM})\\b`, "i"),
    new RegExp(`\\bmove\\s+(?:your\\s+)?stop[- ]?loss\\s+to\\s+(${SIGNAL_PRICE_NUM})\\b`, "i"),
    new RegExp(`\\bstop[- ]?loss\\s+to\\s+(${SIGNAL_PRICE_NUM})\\b`, "i"),
    new RegExp(`عدّ?ل\\s+وقف\\s+الخسارة\\s+إلى\\s+(${SIGNAL_PRICE_NUM})`, "i"),
  ]
  for (const rx of patterns) {
    const m = t.match(rx)
    if (m?.[1]) {
      const p = parseSignalPriceToken(m[1])
      if (p != null && p > 0) return p
    }
  }
  return null
}

export function extractForexBroLockProfitEntryPrice(message: string): number | null {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  const patterns = [
    new RegExp(`entry\\s+price\\s*\\(\\s*(${SIGNAL_PRICE_NUM})\\s*\\)`, "i"),
    new RegExp(`سعر\\s+دخولك\\s*\\(\\s*(${SIGNAL_PRICE_NUM})\\s*\\)`, "i"),
  ]
  for (const rx of patterns) {
    const m = t.match(rx)
    if (m?.[1]) {
      const p = parseSignalPriceToken(m[1])
      if (p != null && p > 0) return p
    }
  }
  return null
}

function baseForexBroFields(message: string): Pick<ForexBroParseResult, "provider_signal_number" | "raw_instruction"> {
  return {
    provider_signal_number: extractProviderSignalNumber(message),
    raw_instruction: message,
  }
}

export function parseForexBroManagementMessage(message: string): ForexBroParseResult | null {
  const t = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  const base = baseForexBroFields(t)

  if (looksLikeForexBroTpCompleteNotice(t)) {
    return {
      action: "ignore",
      symbol: null,
      entry_price: null,
      entry_zone_low: null,
      entry_zone_high: null,
      sl: null,
      tp: [],
      lot_size: null,
      confidence: 1,
      open_tp: false,
      skip_reason: "TP complete notice (no broker action)",
      ...base,
    }
  }

  if (looksLikeForexBroPostFactoBreakeven(t)) {
    return {
      action: "ignore",
      symbol: null,
      entry_price: null,
      entry_zone_low: null,
      entry_zone_high: null,
      sl: null,
      tp: [],
      lot_size: null,
      confidence: 1,
      open_tp: false,
      skip_reason: "Post-facto breakeven narrative (no broker action)",
      ...base,
    }
  }

  if (looksLikeForexBroSlTrailUpdate(t)) {
    const sl = extractForexBroTrailSlPrice(t)
    if (sl == null) return null
    return {
      action: "modify",
      symbol: null,
      entry_price: null,
      entry_zone_low: null,
      entry_zone_high: null,
      sl,
      tp: [],
      lot_size: null,
      confidence: 0.96,
      open_tp: false,
      ...base,
    }
  }

  if (looksLikeForexBroLockProfitAlert(t)) {
    const entryPrice = extractForexBroLockProfitEntryPrice(t)
    return {
      action: "breakeven",
      symbol: null,
      entry_price: entryPrice,
      entry_zone_low: null,
      entry_zone_high: null,
      sl: entryPrice,
      tp: [],
      lot_size: null,
      confidence: 0.94,
      open_tp: false,
      ...base,
    }
  }

  return null
}

export function isProviderSignalNumberToken(message: string, index: number, rawToken: string): boolean {
  const before = String(message ?? "").slice(Math.max(0, index - 24), index)
  return /(?:new\s+signal|signal|صفقة\s+(?:رقم|حديثة))\s*#\s*$/i.test(before)
    && /^\d{1,6}$/.test(String(rawToken).replace(/,/g, ""))
}
