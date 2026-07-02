"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collapseForexBroBilingualMessage = collapseForexBroBilingualMessage;
exports.extractProviderSignalNumber = extractProviderSignalNumber;
exports.looksLikeForexBroSlTrailUpdate = looksLikeForexBroSlTrailUpdate;
exports.looksLikeForexBroTpCompleteNotice = looksLikeForexBroTpCompleteNotice;
exports.looksLikeForexBroPostFactoBreakeven = looksLikeForexBroPostFactoBreakeven;
exports.looksLikeForexBroLockProfitAlert = looksLikeForexBroLockProfitAlert;
exports.extractForexBroTrailSlPrice = extractForexBroTrailSlPrice;
exports.extractForexBroLockProfitEntryPrice = extractForexBroLockProfitEntryPrice;
exports.parseForexBroManagementMessage = parseForexBroManagementMessage;
exports.isProviderSignalNumberToken = isProviderSignalNumberToken;
/**
 * ForexBro Elite Signals — bilingual template detection (entry + management).
 */
const signalPriceFormat_1 = require("./signalPriceFormat");
const FOREXBRO_EN_BANNER = /\b(?:new\s+signal|signal)\s*#/i;
const FOREXBRO_AR_BANNER = /صفقة\s+(?:رقم|حديثة)\s*#/;
/**
 * ForexBro posts the same trade in English then Arabic (often separated by ━━━).
 * Keep only the first block for parsing so labels/prices are not duplicated.
 */
function collapseForexBroBilingualMessage(raw) {
    const rawText = String(raw ?? '');
    if (!rawText.trim())
        return rawText;
    const hasEnglish = FOREXBRO_EN_BANNER.test(rawText);
    const hasArabic = FOREXBRO_AR_BANNER.test(rawText);
    if (!hasEnglish || !hasArabic)
        return rawText;
    const providerNum = extractProviderSignalNumber(rawText);
    if (providerNum == null)
        return rawText;
    const arMatch = rawText.match(/صفقة\s+(?:رقم|حديثة)\s*#\s*(\d{1,6})/i);
    if (!arMatch?.[1] || Number(arMatch[1]) !== providerNum)
        return rawText;
    const separatorIdx = rawText.search(/━{3,}/);
    if (separatorIdx >= 0) {
        const first = rawText.slice(0, separatorIdx).trim();
        if (first)
            return first;
    }
    const arStart = rawText.search(FOREXBRO_AR_BANNER);
    if (arStart > 0) {
        const first = rawText.slice(0, arStart).trim();
        if (first)
            return first;
    }
    return rawText;
}
/** Provider trade id: Signal #899, New Signal #899, صفقة رقم #899 */
function extractProviderSignalNumber(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    const m = t.match(/\b(?:new\s+signal|signal|صفقة\s+(?:رقم|حديثة))\s*#\s*(\d{1,6})\b/i);
    if (!m?.[1])
        return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function looksLikeForexBroSlTrailUpdate(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    if (/\btp\s*\d+\s*:?\s*done\b/i.test(t) && extractForexBroTrailSlPrice(t) != null)
        return true;
    if (/جني\s+الأرباح\s+(?:الأول|الثاني|الثالث)\s*:\s*نجاح/i.test(t) && extractForexBroTrailSlPrice(t) != null) {
        return true;
    }
    return false;
}
function looksLikeForexBroTpCompleteNotice(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    const tp3Done = /\btp\s*3\s*:?\s*done\b/i.test(t) || /الهدف\s+الثالث\s*:?\s*نجاح/i.test(t);
    const allTargets = /\ball\s+targets\b/i.test(t) && /\bachieved\b/i.test(t);
    const hasSlVerb = /\b(?:modify|move|adjust|set|update)\b.*\b(?:stop[- ]?loss|sl)\b/i.test(t)
        || /عدّ?ل\s+وقف\s+الخسارة/i.test(t);
    return tp3Done && allTargets && !hasSlVerb;
}
function looksLikeForexBroPostFactoBreakeven(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    const header = /\b(?:break[- ]?even|تعادل)\b.*\b(?:no\s+loss|بلا\s+خسارة)\b/i.test(t)
        || /\bتعادل\s*—\s*بلا\s+خسارة\b/i.test(t);
    const pastTense = /\b(?:was\s+moved|closed\s+at\s+break[- ]?even|trade\s+closed)\b/i.test(t)
        || /\b(?:نُقل|أُغلقت|عاد\s+السعر)\b/.test(t);
    return header && pastTense;
}
function looksLikeForexBroLockProfitAlert(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    return /\block[- ]?profit\s+alert\b/i.test(t) || /\bتنبيه\s+تأمين\s+الربح\b/i.test(t);
}
function extractForexBroTrailSlPrice(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    const patterns = [
        new RegExp(`\\bmodify\\s+(?:your\\s+)?stop[- ]?loss\\s+to\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'),
        new RegExp(`\\bmove\\s+(?:your\\s+)?stop[- ]?loss\\s+to\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'),
        new RegExp(`\\bstop[- ]?loss\\s+to\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'),
        new RegExp(`عدّ?ل\\s+وقف\\s+الخسارة\\s+إلى\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'i'),
    ];
    for (const rx of patterns) {
        const m = t.match(rx);
        if (m?.[1]) {
            const p = (0, signalPriceFormat_1.parseSignalPriceToken)(m[1]);
            if (p != null && p > 0)
                return p;
        }
    }
    return null;
}
function extractForexBroLockProfitEntryPrice(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    const patterns = [
        new RegExp(`entry\\s+price\\s*\\(\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*\\)`, 'i'),
        new RegExp(`سعر\\s+دخولك\\s*\\(\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*\\)`, 'i'),
        new RegExp(`\\(break[- ]?even\\)\\s*[^\\d]*\\(\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*\\)`, 'i'),
    ];
    for (const rx of patterns) {
        const m = t.match(rx);
        if (m?.[1]) {
            const p = (0, signalPriceFormat_1.parseSignalPriceToken)(m[1]);
            if (p != null && p > 0)
                return p;
        }
    }
    // "Entry price (0.6888) (break-even)"
    const entryParen = t.match(new RegExp(`entry\\s+price\\s*\\(\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*\\)`, 'i'));
    if (entryParen?.[1]) {
        const p = (0, signalPriceFormat_1.parseSignalPriceToken)(entryParen[1]);
        if (p != null && p > 0)
            return p;
    }
    return null;
}
function baseForexBroFields(message) {
    return {
        provider_signal_number: extractProviderSignalNumber(message),
        raw_instruction: message,
    };
}
/**
 * Deterministic ForexBro management parse. Returns null when message is not ForexBro mgmt shape.
 */
function parseForexBroManagementMessage(message) {
    const t = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!t)
        return null;
    const base = baseForexBroFields(t);
    if (looksLikeForexBroTpCompleteNotice(t)) {
        return {
            action: 'ignore',
            symbol: null,
            entry_price: null,
            entry_zone_low: null,
            entry_zone_high: null,
            sl: null,
            tp: [],
            lot_size: null,
            confidence: 1,
            open_tp: false,
            skip_reason: 'TP complete notice (no broker action)',
            ...base,
        };
    }
    if (looksLikeForexBroPostFactoBreakeven(t)) {
        return {
            action: 'ignore',
            symbol: null,
            entry_price: null,
            entry_zone_low: null,
            entry_zone_high: null,
            sl: null,
            tp: [],
            lot_size: null,
            confidence: 1,
            open_tp: false,
            skip_reason: 'Post-facto breakeven narrative (no broker action)',
            ...base,
        };
    }
    if (looksLikeForexBroSlTrailUpdate(t)) {
        const sl = extractForexBroTrailSlPrice(t);
        if (sl == null)
            return null;
        return {
            action: 'modify',
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
        };
    }
    if (looksLikeForexBroLockProfitAlert(t)) {
        const entryPrice = extractForexBroLockProfitEntryPrice(t);
        return {
            action: 'breakeven',
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
        };
    }
    return null;
}
/** True when a bare numeric token is a provider signal id (Signal #898), not a price. */
function isProviderSignalNumberToken(message, index, rawToken) {
    const before = String(message ?? '').slice(Math.max(0, index - 24), index);
    return /(?:new\s+signal|signal|صفقة\s+(?:رقم|حديثة))\s*#\s*$/i.test(before)
        && /^\d{1,6}$/.test(String(rawToken).replace(/,/g, ''));
}
