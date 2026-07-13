"use strict";
/**
 * Common non-English trading terms merged into parser + ingest heuristics.
 * Per-channel AI training can override/extend via channel_keywords.
 *
 * FROZEN for new locales: prefer Universal Signal Understanding (worker/src/signalIntent/)
 * and channel_signal_examples few-shot training instead of expanding this list.
 *
 * Locales align with src/i18n/types.ts (en, es, fr, pl, ru, sv, nl, ja)
 * plus common channel languages (de, ar, pt, it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SELL_NOW_COMPOUND_RE = exports.BUY_NOW_COMPOUND_RE = exports.MULTILINGUAL_DIRECTION_RE = exports.COMMON_ENTRY_TERMS = exports.COMMON_TP_TERMS = exports.COMMON_SL_TERMS = exports.COMMON_SELL_TERMS = exports.COMMON_BUY_TERMS = exports.COMMON_MARKET_NOW_TERMS = exports.SUPPORTED_MARKET_NOW_BY_LOCALE = void 0;
exports.foldAccents = foldAccents;
exports.textHasMultilingualDirection = textHasMultilingualDirection;
exports.messageContainsKeyword = messageContainsKeyword;
exports.isMarketNowDenylistedContext = isMarketNowDenylistedContext;
exports.messageHasDirectionWithImmediateCue = messageHasDirectionWithImmediateCue;
exports.textHasCommonMarketNowIntent = textHasCommonMarketNowIntent;
/** Strip accents so IMMÉDIAT matches immediat aliases. */
function foldAccents(text) {
    return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '');
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** "Now / immediate / at market" cues grouped by locale. */
exports.SUPPORTED_MARKET_NOW_BY_LOCALE = {
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
    /** Often mixed with ES in signal channels */
    pt: ['agora', 'imediato', 'imediata', 'ao mercado'],
    it: ['ora', 'immediato', 'immediata', 'al mercato'],
};
exports.COMMON_MARKET_NOW_TERMS = Object.freeze(Array.from(new Set(Object.values(exports.SUPPORTED_MARKET_NOW_BY_LOCALE).flat())));
exports.COMMON_BUY_TERMS = [
    'achat', 'acheter', // fr
    'compra', 'comprar', // es / pt
    'kupno', 'kupic', 'kupić', 'kup', // pl
    'kaufen', // de
    'köp', // sv
    'kopen', 'koop', // nl
    'купить', 'покупка', // ru
    '買い', // ja
    'شراء', // ar
    'طويل', // ar long
];
exports.COMMON_SELL_TERMS = [
    'vente', 'vendre', // fr
    'venta', 'vender', // es
    'sprzedaz', 'sprzedać', 'sprzedaż', // pl
    'verkaufen', // de
    'sälj', // sv
    'verkopen', 'verkoop', // nl
    'продать', 'продажа', // ru
    '売り', // ja
    'بيع', // ar
    'قصير', // ar short
];
/** Common stop-loss labels merged into parser SL extraction (incl. untrained channels). */
exports.COMMON_SL_TERMS = [
    'وقف الخسارة', 'وقف', // ar
];
/** Common take-profit / target labels merged into parser TP extraction. */
exports.COMMON_TP_TERMS = [
    'الهدف الأول', 'الهدف الثاني', 'الهدف الثالث', 'الهدف', // ar
    'جني الأرباح', 'جني الارباح', // ar
];
/** Common entry zone / price labels. */
exports.COMMON_ENTRY_TERMS = [
    'منطقة الدخول', 'نقطة الدخول', 'سعر الدخول', // ar
];
const MULTILINGUAL_DIRECTION_TERMS = [
    'buy', 'sell', 'long', 'short',
    ...exports.COMMON_BUY_TERMS,
    ...exports.COMMON_SELL_TERMS,
];
/** Direction words for ingest heuristic when channel is not yet trained. */
exports.MULTILINGUAL_DIRECTION_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${MULTILINGUAL_DIRECTION_TERMS.map(t => escapeRegExp(t)).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
/** Unicode-safe direction detection (preferred over MULTILINGUAL_DIRECTION_RE for Arabic script). */
function textHasMultilingualDirection(message) {
    return MULTILINGUAL_DIRECTION_TERMS.some(t => messageContainsKeyword(message, t));
}
const JA_MARKET_NOW_RE = /今すぐ|即時|成行|ナウ/u;
exports.BUY_NOW_COMPOUND_RE = new RegExp('\\b('
    + [
        'buy', 'long',
        ...exports.COMMON_BUY_TERMS,
        'comprar', 'compra', 'acheter', 'achat',
    ].map(t => escapeRegExp(t)).join('|')
    + ')\\s+('
    + [
        'now', 'instant',
        ...exports.COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' ')),
    ].map(t => escapeRegExp(foldAccents(t))).join('|')
    + ')\\b', 'iu');
exports.SELL_NOW_COMPOUND_RE = new RegExp('\\b('
    + [
        'sell', 'short',
        ...exports.COMMON_SELL_TERMS,
    ].map(t => escapeRegExp(t)).join('|')
    + ')\\s+('
    + [
        'now', 'instant',
        ...exports.COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' ')),
    ].map(t => escapeRegExp(foldAccents(t))).join('|')
    + ')\\b', 'iu');
/** Accent- and case-insensitive keyword boundary match (Unicode-aware). */
function messageContainsKeyword(text, phrase) {
    const raw = String(text ?? '');
    const folded = foldAccents(raw);
    const foldedPhrase = foldAccents(String(phrase ?? '').trim());
    if (!foldedPhrase)
        return false;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(foldedPhrase).replace(/\\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
    return pattern.test(folded);
}
/** Commentary contexts where "right now" is position talk, not market entry. */
function isMarketNowDenylistedContext(message) {
    const text = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (/\b(?:we|trade)\s+right\s+now\s+in\b/i.test(text))
        return true;
    if (/\bright\s+now\s+in,?\s+(?:selling|buying)\b/i.test(text))
        return true;
    if (/\btrade\s+we\b.{0,40}\bright\s+now\b/i.test(text))
        return true;
    return false;
}
/** True when buy/sell vocabulary co-occurs with immediate-entry cues (incl. foreign, spaced instruments). */
function messageHasDirectionWithImmediateCue(message) {
    if (isMarketNowDenylistedContext(message))
        return false;
    const folded = foldAccents(message);
    if (exports.BUY_NOW_COMPOUND_RE.test(folded))
        return true;
    if (exports.SELL_NOW_COMPOUND_RE.test(folded))
        return true;
    const buyHit = ['buy', 'long', ...exports.COMMON_BUY_TERMS]
        .some(t => messageContainsKeyword(message, t));
    const sellHit = ['sell', 'short', ...exports.COMMON_SELL_TERMS]
        .some(t => messageContainsKeyword(message, t));
    if (!buyHit && !sellHit)
        return false;
    const nowTerms = exports.COMMON_MARKET_NOW_TERMS.filter(t => t.length <= 12 && !t.includes(' '));
    if (!nowTerms.some(t => messageContainsKeyword(message, t)))
        return false;
    return true;
}
/** True when message contains buy/sell paired with immediate-entry cues (not bare "now"). */
function textHasCommonMarketNowIntent(message) {
    const raw = String(message ?? '');
    if (isMarketNowDenylistedContext(raw))
        return false;
    if (/\b(at\s+market|@\s*market)\b/i.test(raw))
        return true;
    if (JA_MARKET_NOW_RE.test(raw))
        return true;
    if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+now\b/i.test(raw))
        return true;
    if (/\b(?:buy|sell)\s+(?:gold|xau(?:usd)?)\s+now\b/i.test(raw))
        return true;
    if (/(?:ذهب|xau(?:usd)?)/iu.test(raw) && textHasMultilingualDirection(raw)) {
        if (exports.COMMON_MARKET_NOW_TERMS.some(t => messageContainsKeyword(raw, t)))
            return true;
    }
    return messageHasDirectionWithImmediateCue(raw);
}
