/**
 * Common non-English trading terms merged into parser + ingest heuristics.
 * Per-channel AI training can override/extend via channel_keywords.
 *
 * Locales align with src/i18n/types.ts (en, es, fr, pl, ru, sv, nl, ja)
 * plus common channel languages (de, ar, pt, it).
 */

/** Strip accents so IMMÉDIAT matches immediat aliases. */
export function foldAccents(text: string): string {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "Now / immediate / at market" cues grouped by locale. */
export const SUPPORTED_MARKET_NOW_BY_LOCALE = {
  en: ['now', 'instant', 'immediately', 'immediate', 'right now', 'at market', 'market order', 'mkt'],
  fr: ['maintenant', 'immédiat', 'immediat', 'immédiate', 'immédiatement', 'tout de suite', 'au marché'],
  es: ['ahora', 'inmediato', 'inmediata', 'al mercado', 'a mercado'],
  pl: ['teraz', 'natychmiast', 'od razu', 'na rynku'],
  ru: ['сейчас', 'немедленно', 'по рынку'],
  sv: ['nu', 'omedelbart', 'direkt', 'på marknaden'],
  nl: ['nu', 'onmiddellijk', 'direct', 'aan de markt'],
  ja: ['今すぐ', '即時', '成行', 'ナウ'],
  de: ['jetzt', 'sofort', 'am markt'],
  ar: ['الآن', 'فوراً', 'فورا'],
  /** Often mixed with ES in signal channels */
  pt: ['agora', 'imediato', 'imediata', 'ao mercado'],
  it: ['ora', 'immediato', 'immediata', 'al mercato'],
} as const

export type SupportedMarketNowLocale = keyof typeof SUPPORTED_MARKET_NOW_BY_LOCALE

export const COMMON_MARKET_NOW_TERMS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.values(SUPPORTED_MARKET_NOW_BY_LOCALE).flat())),
)

export const COMMON_BUY_TERMS = [
  'achat', 'acheter',           // fr
  'compra', 'comprar',          // es / pt
  'kupno', 'kupic', 'kupić', 'kup', // pl
  'kaufen',                     // de
  'köp',                        // sv
  'kopen', 'koop',              // nl
  'купить', 'покупка',          // ru
  '買い',                       // ja
  'شراء',                       // ar
]

export const COMMON_SELL_TERMS = [
  'vente', 'vendre',            // fr
  'venta', 'vender',            // es
  'sprzedaz', 'sprzedać', 'sprzedaż', // pl
  'verkaufen',                  // de
  'sälj',                       // sv
  'verkopen', 'verkoop',        // nl
  'продать', 'продажа',         // ru
  '売り',                       // ja
  'بيع',                        // ar
]

/** Direction words for ingest heuristic when channel is not yet trained. */
export const MULTILINGUAL_DIRECTION_RE = new RegExp(
  '\\b('
  + [
    'buy', 'sell', 'long', 'short',
    ...COMMON_BUY_TERMS,
    ...COMMON_SELL_TERMS,
  ].map(t => escapeRegExp(t)).join('|')
  + ')\\b',
  'iu',
)

const JA_MARKET_NOW_RE = /今すぐ|即時|成行|ナウ/u

export const BUY_NOW_COMPOUND_RE = new RegExp(
  '\\b('
  + [
    'buy', 'long',
    ...COMMON_BUY_TERMS,
    'comprar', 'compra', 'acheter', 'achat',
  ].map(t => escapeRegExp(t)).join('|')
  + ')\\s+('
  + [
    'now', 'instant',
    ...COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' ')),
  ].map(t => escapeRegExp(foldAccents(t))).join('|')
  + ')\\b',
  'iu',
)

export const SELL_NOW_COMPOUND_RE = new RegExp(
  '\\b('
  + [
    'sell', 'short',
    ...COMMON_SELL_TERMS,
  ].map(t => escapeRegExp(t)).join('|')
  + ')\\s+('
  + [
    'now', 'instant',
    ...COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' ')),
  ].map(t => escapeRegExp(foldAccents(t))).join('|')
  + ')\\b',
  'iu',
)

/** Accent- and case-insensitive keyword boundary match (Unicode-aware). */
export function messageContainsKeyword(text: string, phrase: string): boolean {
  const raw = String(text ?? '')
  const folded = foldAccents(raw)
  const foldedPhrase = foldAccents(String(phrase ?? '').trim())
  if (!foldedPhrase) return false
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(foldedPhrase).replace(/\\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`,
    'iu',
  )
  return pattern.test(folded)
}

/** Commentary contexts where "right now" is position talk, not market entry. */
export function isMarketNowDenylistedContext(message: string): boolean {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (/\b(?:we|trade)\s+right\s+now\s+in\b/i.test(text)) return true
  if (/\bright\s+now\s+in,?\s+(?:selling|buying)\b/i.test(text)) return true
  if (/\btrade\s+we\b.{0,40}\bright\s+now\b/i.test(text)) return true
  return false
}

/** True when buy/sell vocabulary co-occurs with immediate-entry cues (incl. foreign, spaced instruments). */
export function messageHasDirectionWithImmediateCue(message: string): boolean {
  if (isMarketNowDenylistedContext(message)) return false

  const folded = foldAccents(message)
  if (BUY_NOW_COMPOUND_RE.test(folded)) return true
  if (SELL_NOW_COMPOUND_RE.test(folded)) return true

  const buyHit = ['buy', 'long', ...COMMON_BUY_TERMS]
    .some(t => messageContainsKeyword(message, t))
  const sellHit = ['sell', 'short', ...COMMON_SELL_TERMS]
    .some(t => messageContainsKeyword(message, t))
  if (!buyHit && !sellHit) return false

  const nowTerms = COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' '))
  if (!nowTerms.some(t => messageContainsKeyword(message, t))) return false

  return true
}

/** True when message contains buy/sell paired with immediate-entry cues (not bare "now"). */
export function textHasCommonMarketNowIntent(message: string): boolean {
  const raw = String(message ?? '')
  if (isMarketNowDenylistedContext(raw)) return false

  if (/\b(at\s+market|@\s*market)\b/i.test(raw)) return true
  if (JA_MARKET_NOW_RE.test(raw)) return true
  if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+now\b/i.test(raw)) return true
  if (/\b(?:buy|sell)\s+(?:gold|xau(?:usd)?)\s+now\b/i.test(raw)) return true

  return messageHasDirectionWithImmediateCue(raw)
}
