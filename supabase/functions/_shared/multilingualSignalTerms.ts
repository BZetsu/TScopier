/**
 * Shared market-now / multilingual signal terms (keep in sync with worker/src/multilingualSignalTerms.ts).
 */

export function foldAccents(text: string): string {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  ar: ['الآن', 'فوراً', 'فورا', 'مباشرة', 'فوري', 'عند السوق', 'أمر سوق', 'امر سوق'],
  pt: ['agora', 'imediato', 'imediata', 'ao mercado'],
  it: ['ora', 'immediato', 'immediata', 'al mercato'],
} as const

export const COMMON_MARKET_NOW_TERMS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.values(SUPPORTED_MARKET_NOW_BY_LOCALE).flat())),
)

export const COMMON_BUY_TERMS = [
  'achat', 'acheter',
  'compra', 'comprar',
  'kupno', 'kupic', 'kupić', 'kup',
  'kaufen',
  'köp',
  'kopen', 'koop',
  'купить', 'покупка',
  '買い',
  'شراء',
  'طويل',
]

export const COMMON_SELL_TERMS = [
  'vente', 'vendre',
  'venta', 'vender',
  'sprzedaz', 'sprzedać', 'sprzedaż',
  'verkaufen',
  'sälj',
  'verkopen', 'verkoop',
  'продать', 'продажа',
  '売り',
  'بيع',
  'قصير',
]

export const COMMON_SL_TERMS = [
  'وقف الخسارة', 'وقف',
]

export const COMMON_TP_TERMS = [
  'الهدف الأول', 'الهدف الثاني', 'الهدف الثالث', 'الهدف',
  'جني الأرباح', 'جني الارباح',
]

export const COMMON_ENTRY_TERMS = [
  'منطقة الدخول', 'نقطة الدخول', 'سعر الدخول',
]

const MULTILINGUAL_DIRECTION_TERMS = [
  'buy', 'sell', 'long', 'short',
  ...COMMON_BUY_TERMS,
  ...COMMON_SELL_TERMS,
] as const

export const MULTILINGUAL_DIRECTION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${
    MULTILINGUAL_DIRECTION_TERMS.map(t => escapeRegExp(t)).join('|')
  })(?![\\p{L}\\p{N}])`,
  'iu',
)

export function textHasMultilingualDirection(message: string): boolean {
  return MULTILINGUAL_DIRECTION_TERMS.some(t => messageContainsKeyword(message, t))
}

const JA_MARKET_NOW_RE = /今すぐ|即時|成行|ナウ/u

export const BUY_NOW_COMPOUND_RE = new RegExp(
  '\\b('
  + ['buy', 'long', ...COMMON_BUY_TERMS, 'comprar', 'compra', 'acheter', 'achat']
    .map(t => escapeRegExp(t)).join('|')
  + ')\\s+('
  + ['now', 'instant', ...COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' '))]
    .map(t => escapeRegExp(foldAccents(t))).join('|')
  + ')\\b',
  'iu',
)

export const SELL_NOW_COMPOUND_RE = new RegExp(
  '\\b('
  + ['sell', 'short', ...COMMON_SELL_TERMS].map(t => escapeRegExp(t)).join('|')
  + ')\\s+('
  + ['now', 'instant', ...COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' '))]
    .map(t => escapeRegExp(foldAccents(t))).join('|')
  + ')\\b',
  'iu',
)

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

  const buyHit = ["buy", "long", ...COMMON_BUY_TERMS]
    .some((t) => messageContainsKeyword(message, t))
  const sellHit = ["sell", "short", ...COMMON_SELL_TERMS]
    .some((t) => messageContainsKeyword(message, t))
  if (!buyHit && !sellHit) return false

  const nowTerms = COMMON_MARKET_NOW_TERMS.filter((t) => t.length <= 12 && !t.includes(" "))
  if (!nowTerms.some((t) => messageContainsKeyword(message, t))) return false

  return true
}

export function textHasCommonMarketNowIntent(message: string): boolean {
  const raw = String(message ?? "")
  if (isMarketNowDenylistedContext(raw)) return false

  if (/\b(at\s+market|@\s*market)\b/i.test(raw)) return true
  if (JA_MARKET_NOW_RE.test(raw)) return true
  if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+now\b/i.test(raw)) return true
  if (/\b(?:buy|sell)\s+(?:gold|xau(?:usd)?)\s+now\b/i.test(raw)) return true
  if (/(?:ذهب|xau(?:usd)?)/iu.test(raw) && textHasMultilingualDirection(raw)) {
    if (COMMON_MARKET_NOW_TERMS.some(t => messageContainsKeyword(raw, t))) return true
  }

  return messageHasDirectionWithImmediateCue(raw)
}
