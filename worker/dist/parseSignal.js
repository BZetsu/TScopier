"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeExplicitFullCloseCommand = exports.looksLikeChannelManagementUpdate = exports.DEFAULT_CHANNEL_KEYWORDS = void 0;
exports.normalizeChannelKeywords = normalizeChannelKeywords;
exports.loadChannelLexicon = loadChannelLexicon;
exports.loadChannelKeywords = loadChannelKeywords;
exports.enrichParsedKeywordMatch = enrichParsedKeywordMatch;
exports.parseModificationDeterministic = parseModificationDeterministic;
exports.normalizeAiParsedOutput = normalizeAiParsedOutput;
exports.parseChannelMessageSync = parseChannelMessageSync;
exports.parseRawChannelMessage = parseRawChannelMessage;
const signalPriceInference_1 = require("./signalPriceInference");
const signalManagementIntent_1 = require("./signalManagementIntent");
const signalPriceFormat_1 = require("./signalPriceFormat");
const tradableSymbol_1 = require("./tradableSymbol");
const signalCommentaryGuard_1 = require("./signalCommentaryGuard");
const signalImperativeEntry_1 = require("./signalImperativeEntry");
const normalizeTelegramMessageText_1 = require("./normalizeTelegramMessageText");
const multilingualManagementTerms_1 = require("./multilingualManagementTerms");
const trainingManagementKeywords_1 = require("./trainingManagementKeywords");
const multilingualSignalTerms_1 = require("./multilingualSignalTerms");
const signalEntryNowRequirement_1 = require("./signalEntryNowRequirement");
const forexBroSignalPatterns_1 = require("./forexBroSignalPatterns");
const signalStopUnits_1 = require("./signalStopUnits");
/** Loose hint that a message references a Deriv synthetic index (any alias form). */
const DERIV_SYNTHETIC_HINT_RE = /\b(?:v(?:ix)?\s*\d{2,3}|vol(?:atility)?\s*\d{2,3}|r_?\d{2,3}|1hz\d{1,3}v|boom\s*\d{3,4}|crash\s*\d{3,4}|step(?:\s*index)?|stprng\d?|jump\s*\d{2,3}|jd\d{2,3}|range\s*break|rdbull|rdbear|bull\s*market|bear\s*market)\b/i;
exports.DEFAULT_CHANNEL_KEYWORDS = {
    signal: {
        entry_point: "ENTRY",
        buy: "BUY",
        sell: "SELL",
        sl: "SL",
        tp: "TP",
        market_order: "MARKET",
    },
    update: {
        close_tp1: "CLOSE TP1",
        close_tp2: "CLOSE TP2",
        close_tp3: "CLOSE TP3",
        close_tp4: "CLOSE TP4",
        close_full: "CLOSE FULL",
        close_half: "CLOSE HALF",
        close_partial: "CLOSE PARTIAL",
        close_worse_entries: "CLOSE WORSE ENTRIES|CLOSE WORSE|CWE",
        break_even: "BREAK EVEN",
        set_tp1: "SET TP1",
        set_tp2: "SET TP2",
        set_tp3: "SET TP3",
        set_tp4: "SET TP4",
        set_tp5: "SET TP5",
        set_tp: "SET TP",
        adjust_tp: "ADJUST TP",
        set_sl: "SET SL|SET STOP LOSS|SET STOPLOSS|SET RISK",
        adjust_sl: "ADJUST SL|ADJUST STOP LOSS|ADJUST STOPLOSS|ADJUST RISK"
            + "|MOVE SL|MOVE STOP LOSS|MOVE STOPLOSS|MOVE RISK"
            + "|CHANGE SL|CHANGE STOP LOSS|CHANGE STOPLOSS|CHANGE RISK"
            + "|UPDATE SL|UPDATE STOP LOSS|UPDATE STOPLOSS|UPDATE RISK",
        delete: "DELETE",
    },
    additional: {
        layer: "LAYER",
        close_all: "CLOSE ALL",
        delete_all: "DELETE ALL",
        ignore_keyword: "IGNORE",
        skip_keyword: "SKIP",
        remove_sl: "REMOVE SL",
        delay_msec: 0,
        prefer_entry: "first_price",
        sl_in_pips: false,
        tp_in_pips: false,
        delimiters: "",
        all_order: false,
        read_forwarded: true,
        read_image: false,
    },
};
function normalizeChannelKeywords(raw) {
    const j = raw && typeof raw === "object" ? raw : {};
    const signal = j.signal && typeof j.signal === "object" ? j.signal : {};
    const update = j.update && typeof j.update === "object" ? j.update : {};
    const additional = j.additional && typeof j.additional === "object" ? j.additional : {};
    return {
        signal: {
            entry_point: String(signal.entry_point ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.entry_point),
            buy: String(signal.buy ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.buy),
            sell: String(signal.sell ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.sell),
            sl: String(signal.sl ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.sl),
            tp: String(signal.tp ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.tp),
            market_order: String(signal.market_order ?? exports.DEFAULT_CHANNEL_KEYWORDS.signal.market_order),
        },
        update: {
            close_tp1: String(update.close_tp1 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_tp1),
            close_tp2: String(update.close_tp2 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_tp2),
            close_tp3: String(update.close_tp3 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_tp3),
            close_tp4: String(update.close_tp4 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_tp4),
            close_full: String(update.close_full ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_full),
            close_half: String(update.close_half ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_half),
            close_partial: String(update.close_partial ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_partial),
            close_worse_entries: String(update.close_worse_entries ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.close_worse_entries),
            break_even: String(update.break_even ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.break_even),
            set_tp1: String(update.set_tp1 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp1),
            set_tp2: String(update.set_tp2 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp2),
            set_tp3: String(update.set_tp3 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp3),
            set_tp4: String(update.set_tp4 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp4),
            set_tp5: String(update.set_tp5 ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp5),
            set_tp: String(update.set_tp ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_tp),
            adjust_tp: String(update.adjust_tp ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.adjust_tp),
            set_sl: String(update.set_sl ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.set_sl),
            adjust_sl: String(update.adjust_sl ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.adjust_sl),
            delete: String(update.delete ?? exports.DEFAULT_CHANNEL_KEYWORDS.update.delete),
        },
        additional: {
            layer: String(additional.layer ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.layer),
            close_all: String(additional.close_all ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.close_all),
            delete_all: String(additional.delete_all ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.delete_all),
            ignore_keyword: String(additional.ignore_keyword ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.ignore_keyword),
            skip_keyword: String(additional.skip_keyword ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.skip_keyword),
            remove_sl: String(additional.remove_sl ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.remove_sl),
            delay_msec: Number(additional.delay_msec ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.delay_msec) || 0,
            prefer_entry: String(additional.prefer_entry ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.prefer_entry) === "last_price"
                ? "last_price"
                : "first_price",
            sl_in_pips: Boolean(additional.sl_in_pips ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.sl_in_pips),
            tp_in_pips: Boolean(additional.tp_in_pips ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.tp_in_pips),
            delimiters: String(additional.delimiters ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.delimiters),
            all_order: Boolean(additional.all_order ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.all_order),
            read_forwarded: Boolean(additional.read_forwarded ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.read_forwarded),
            read_image: Boolean(additional.read_image ?? exports.DEFAULT_CHANNEL_KEYWORDS.additional.read_image),
        },
    };
}
function splitKeywordAliases(raw, delimiters = "") {
    const extra = String(delimiters ?? "").replace(/\s+/g, "");
    const chars = [",", ";", "\n", "|", ...extra.split("")].filter(Boolean).map((c) => escapeRegExp(c));
    const splitter = new RegExp(`[${chars.join("")}]+`);
    return String(raw ?? "")
        .split(splitter)
        .map((x) => x.trim())
        .filter(Boolean);
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function keywordRegex(phrase) {
    const p = escapeRegExp(phrase.trim()).replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, 'iu');
}
function hasAnyKeyword(text, words) {
    const folded = (0, multilingualSignalTerms_1.foldAccents)(text);
    return words.some((w) => {
        if (!w)
            return false;
        return keywordRegex(w).test(text) || keywordRegex((0, multilingualSignalTerms_1.foldAccents)(w)).test(folded);
    });
}
/** Soft prose around "entry" that is discussion, not a priced entry level. */
function isSoftEntryProse(message) {
    return (/\b(?:not a bad|good|nice|solid|decent|bad)\s+entry\b/i.test(message)
        || /\b(?:our|the|this|that)\s+entry\b/i.test(message)
        || /\bclose to (?:our\s+)?entry\b/i.test(message));
}
/**
 * True when an entry_point keyword is backed by a numeric price/zone nearby,
 * or the alias itself is an imperative phrase (e.g. "gold buy now") rather than bare "ENTRY".
 * Bare prose "not a bad entry" must not count as price evidence.
 */
function hasEntryPointPriceEvidence(message, entryPointAliases) {
    if (!entryPointAliases.length)
        return false;
    if (isSoftEntryProse(message) && !/\bentry\s*(?:price|level)?\s*[:=\-]?\s*\d/i.test(message)) {
        return false;
    }
    const text = message.replace(/\s+/g, ' ').trim();
    for (const alias of entryPointAliases) {
        const a = String(alias ?? '').trim();
        if (!a)
            continue;
        if (!hasAnyKeyword(message, [a]))
            continue;
        // Phrase aliases that already encode an imperative entry (not the word "entry" alone).
        if (!/^\s*entr(?:y|ée|ee)\s*$/i.test(a) && !/\bentry\b/i.test(a)) {
            return true;
        }
        if (/\b(?:buy|sell)\s+now\b/i.test(a) || /\b(?:now|market)\b/i.test(a)) {
            return true;
        }
        // Require a numeric price adjacent to this entry label.
        const labeled = new RegExp(`${escapeRegExp(a).replace(/\s+/g, '\\s+')}\\s*(?:price|level)?\\s*[:=\\-]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'i');
        if (labeled.test(text))
            return true;
        const zone = new RegExp(`${escapeRegExp(a).replace(/\s+/g, '\\s+')}\\s*(?:price|level)?\\s*[:=\\-]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:\\/|\\band\\b|-|–|to)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'i');
        if (zone.test(text))
            return true;
    }
    // Generic "entry 2650" / "entry: 2650-2655" even when alias is just ENTRY.
    if (/\bentry\s*(?:price|level)?\s*[:=]?\s*\d/i.test(text))
        return true;
    if (/\bentry\s+zone\b/i.test(text) && new RegExp(signalPriceFormat_1.SIGNAL_PRICE_NUM).test(text))
        return true;
    return false;
}
function lexiconActionAliases(lexicon, key) {
    const raw = lexicon?.action_aliases?.[key];
    if (!Array.isArray(raw))
        return [];
    return raw.map((a) => String(a).trim()).filter(Boolean);
}
function buyAliasesForChannel(channelKeywords, lexicon = null) {
    const delim = channelKeywords.additional.delimiters;
    return Array.from(new Set([
        'buy', 'long',
        ...multilingualSignalTerms_1.COMMON_BUY_TERMS,
        ...splitKeywordAliases(channelKeywords.signal.buy, delim),
        ...lexiconActionAliases(lexicon, 'buy'),
    ]));
}
/** Sell aliases like "tp: open" must not count as sell direction on buy + TP posts. */
function sellAliasesForChannel(channelKeywords, lexicon = null) {
    const delim = channelKeywords.additional.delimiters;
    return Array.from(new Set([
        'sell', 'short',
        ...multilingualSignalTerms_1.COMMON_SELL_TERMS,
        ...splitKeywordAliases(channelKeywords.signal.sell, delim),
        ...lexiconActionAliases(lexicon, 'sell'),
    ])).filter(alias => {
        const t = alias.trim().toLowerCase();
        if (!t)
            return false;
        if (/^tp\s*:/i.test(t) && !/\b(sell|short)\b/i.test(t))
            return false;
        if (/^all\s+tp/i.test(t) && !/\b(sell|short)\b/i.test(t))
            return false;
        return true;
    });
}
function slLabelsForChannel(channelKeywords, includeMgmt = true) {
    const delim = channelKeywords.additional.delimiters;
    return Array.from(new Set([
        ...multilingualSignalTerms_1.COMMON_SL_TERMS,
        ...splitKeywordAliases(channelKeywords.signal.sl, delim),
        ...(includeMgmt ? [
            ...splitKeywordAliases(channelKeywords.update.set_sl, delim),
            ...splitKeywordAliases(channelKeywords.update.adjust_sl, delim),
        ] : []),
    ]));
}
function tpLabelsForChannel(channelKeywords, lexicon = null, includeMgmt = true) {
    const delim = channelKeywords.additional.delimiters;
    return Array.from(new Set([
        ...multilingualSignalTerms_1.COMMON_TP_TERMS,
        ...(lexicon?.tp_aliases ?? []),
        ...(lexicon?.target_aliases ?? []),
        ...splitKeywordAliases(channelKeywords.signal.tp, delim),
        ...(includeMgmt ? [
            ...splitKeywordAliases(channelKeywords.update.set_tp, delim),
            ...splitKeywordAliases(channelKeywords.update.adjust_tp, delim),
        ] : []),
    ]));
}
function entryLabelsForChannel(channelKeywords) {
    const delim = channelKeywords.additional.delimiters;
    return Array.from(new Set([
        ...multilingualSignalTerms_1.COMMON_ENTRY_TERMS,
        ...splitKeywordAliases(channelKeywords.signal.entry_point, delim),
    ]));
}
function isProseLongMatch(text) {
    return /(?:^|\b)(?:too|so|as|how)\s+long(?:\b|$)/i.test(text);
}
function isProseShortMatch(text) {
    return (/\bshort\s+of\b/i.test(text)
        || /\bin\s+short\b/i.test(text)
        || /\bshort\s+term\b/i.test(text));
}
function isGerundOrPastSideProse(message) {
    return (/\b(?:selling|buying)\s+(?:gold|xau(?:usd)?|silver|xag(?:usd)?|btc(?:usd|usdt)?|bitcoin|eth(?:usd)?)\b/i.test(message)
        || /\b(?:sold|bought)\s+(?:gold|xau(?:usd)?|silver|xag(?:usd)?)\b/i.test(message)
        || /\b(?:gold|xau(?:usd)?)\s+(?:sold|bought)\b/i.test(message));
}
function isGerundSideKeyword(text, side) {
    if (side === 'buy') {
        return /\bbuying\b/i.test(text) && !/\bbuy\s+now\b/i.test(text);
    }
    return /\bselling\b/i.test(text) && !/\bsell\s+now\b/i.test(text);
}
function parseBuySideFromKeywords(text, words) {
    for (const w of words) {
        if (!w)
            continue;
        const lower = w.toLowerCase().trim();
        if (lower === 'buy' && isGerundSideKeyword(text, 'buy'))
            continue;
        if (lower === 'long') {
            if (isProseLongMatch(text))
                continue;
            if (keywordRegex('long').test(text))
                return true;
            continue;
        }
        if (keywordRegex(w).test(text))
            return true;
    }
    return false;
}
function parseSellSideFromKeywords(text, words) {
    for (const w of words) {
        if (!w)
            continue;
        const lower = w.toLowerCase().trim();
        if (lower === 'sell' && isGerundSideKeyword(text, 'sell'))
            continue;
        if (lower === 'short') {
            if (isProseShortMatch(text))
                continue;
            if (keywordRegex('short').test(text))
                return true;
            continue;
        }
        if (keywordRegex(w).test(text))
            return true;
    }
    return false;
}
function parseSideFromKeywords(text, words) {
    return hasAnyKeyword(text, words);
}
/** Sell aliases like "tp: open" must not count as sell direction on buy + TP posts. */
function sellAliasesForSideDetection(channelKeywords, lexicon = null) {
    return sellAliasesForChannel(channelKeywords, lexicon);
}
function resolveTradeSideFromMessage(message, channelKeywords, lexicon = null) {
    const text = message.replace(/\s+/g, ' ').trim();
    if (isGerundOrPastSideProse(text) && !(0, signalImperativeEntry_1.messageHasImperativeEntryPhrase)(text, channelKeywords)) {
        return null;
    }
    const goldBuy = /\bgold\s+buy\b|\bbuy\s+gold\b/i.test(text);
    const goldSell = /\bgold\s+sell\b|\bsell\s+gold\b/i.test(text);
    if (goldBuy && !goldSell)
        return 'buy';
    if (goldSell && !goldBuy)
        return 'sell';
    const buyAliases = buyAliasesForChannel(channelKeywords, lexicon);
    const sellAliases = sellAliasesForSideDetection(channelKeywords, lexicon);
    const isBuy = parseBuySideFromKeywords(message, buyAliases);
    const isSell = parseSellSideFromKeywords(message, sellAliases);
    if (isBuy && !isSell)
        return 'buy';
    if (isSell && !isBuy)
        return 'sell';
    return null;
}
function buildTpRegex(extraLabels = []) {
    const base = ["tp", "take\\s*profit", "target(?:\\s+level)?"];
    const custom = extraLabels.map((x) => escapeRegExp(x.trim())).filter(Boolean);
    // Guard against tier ordinals being mistaken for TP prices in shapes like:
    // "Take Profit 1: 4514.00" (capture 4514, not the ordinal 1).
    return new RegExp(`\\b(?:${[...base, ...custom].join("|")})(?:\\s*[:=\\-]\\s*|\\s+|\\.\\s*)(${signalPriceFormat_1.SIGNAL_PRICE_NUM})(?!\\s*[:=\\-]\\s*${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, "gi");
}
function extractTpLevels(message, extraLabels = []) {
    const text = String(message ?? "");
    const hits = [];
    let explicitPips = (0, signalStopUnits_1.tpClauseHasExplicitPips)(text);
    const collect = (rx) => {
        for (const m of text.matchAll(rx)) {
            const value = (0, signalPriceFormat_1.parseSignalPriceToken)(m[1]);
            if (value == null)
                continue;
            hits.push({ index: m.index ?? 0, value });
            const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
            if (/^\s*pips?\b/i.test(after) || /^pips?\b/i.test(after))
                explicitPips = true;
        }
    };
    // Numbered tiers first — "TP 1 4086" must not capture ordinal 1 via the generic TP regex.
    collect(new RegExp(`\\b(?:tp|take\\s*profit|target(?:\\s+level)?)\\s*#\\s*\\d+\\s*[:=\\-]\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    collect(new RegExp(`\\b(?:tp|take\\s*profit|target(?:\\s+level)?)\\s+\\d+\\s*[:=\\-]\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    collect(new RegExp(`\\b(?:tp|target(?:\\s+level)?)\\s*\\d+\\s*[:=\\-]\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    collect(new RegExp(`\\b(?:tp|target(?:\\s+level)?)\\s*\\d+\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    collect(new RegExp(`\\btp\\s*\\.\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    // Tier index only (1–2 digits): "TP1. 4066". Must not match "TP 4053.22" (full decimal price).
    collect(new RegExp(`\\btp\\s*\\d{1,2}\\s*\\.\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'gi'));
    collect(new RegExp(`\\btp[\\u00B9\\u00B2\\u00B3\\u2070-\\u2079]+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'giu'));
    collect(new RegExp(`(?:الهدف\\s*(?:الأول|الثاني|الثالث|\\d+)|جني\\s*الأرباح|جني\\s*الارباح)\\s*[:：]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'giu'));
    collect(buildTpRegex(extraLabels));
    // TP: 4557 / 4527 (slash-separated tiers on one label — not thousands commas)
    for (const m of text.matchAll(/\b(?:tp|take\s*profit|target(?:\s+level)?)\s*[:=]?\s*((?:\d+(?:\.\d+)?(?:\s*(?:\/|\band\b|\|)\s*)+)+\d+(?:\.\d+)?)(?:\s*pips?\b)?/gi)) {
        const block = m[1] ?? '';
        const base = m.index ?? 0;
        const offset = m[0].indexOf(block);
        const normalized = block.replace(/,/g, '');
        if (/\bpips?\b/i.test(m[0]))
            explicitPips = true;
        for (const part of normalized.split(/\s*(?:\/|\band\b|\|)\s*/i)) {
            const value = (0, signalPriceFormat_1.parseSignalPriceToken)(part.trim());
            if (value == null)
                continue;
            const partStart = base + offset + normalized.indexOf(part);
            hits.push({ index: partStart, value });
        }
    }
    if (!hits.length)
        return { values: [], explicitPips: false };
    hits.sort((a, b) => a.index - b.index);
    const seenIndex = new Set();
    const seenValues = new Set();
    const values = [];
    for (const hit of hits) {
        if (seenIndex.has(hit.index))
            continue;
        seenIndex.add(hit.index);
        if (seenValues.has(hit.value))
            continue;
        seenValues.add(hit.value);
        values.push(hit.value);
    }
    return { values, explicitPips };
}
function detectOpenTp(message) {
    const t = String(message ?? "");
    return /\b(open\s*tp|without\s*tp|no\s*tp|runner|let\s+it\s+run|leave\s+runner)\b/i.test(t)
        || /\b(?:tp|take\s*profit)\s*[:=]?\s*open\b/i.test(t);
}
function extractPriceByLabels(message, labels) {
    for (const label of labels) {
        const k = String(label ?? "").trim();
        if (!k)
            continue;
        const rx = new RegExp(`${escapeRegExp(k).replace(/\s+/g, "\\s*")}\\s*[:=\\-]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, "i");
        const m = message.match(rx);
        if (m?.[1]) {
            const n = (0, signalPriceFormat_1.parseSignalPriceToken)(m[1]);
            if (n != null)
                return n;
        }
    }
    return null;
}
function isManagementAction(action) {
    return new Set([
        "close",
        "close_worse_entries",
        "breakeven",
        "partial_profit",
        "partial_breakeven",
        "modify",
    ]).has(String(action ?? "").toLowerCase());
}
function normalizeParsedFromModel(raw, fallbackText) {
    const j = raw && typeof raw === "object" ? raw : {};
    let action = String(j.action ?? "ignore").trim().toLowerCase();
    if (action === "long")
        action = "buy";
    if (action === "short")
        action = "sell";
    const allowed = new Set([
        "buy", "sell", "close", "close_worse_entries", "breakeven", "partial_profit", "partial_breakeven", "modify", "ignore",
    ]);
    if (!allowed.has(action))
        action = "ignore";
    const numOrNull = (v) => {
        if (v == null || v === "")
            return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    let symbol = (0, tradableSymbol_1.sanitizeParsedSymbol)(typeof j.symbol === "string" ? j.symbol : null);
    let tp = [];
    if (Array.isArray(j.tp)) {
        tp = j.tp.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    }
    let confidence = Number(j.confidence);
    if (!Number.isFinite(confidence)) {
        confidence = action !== "ignore" ? 0.95 : 0;
    }
    confidence = Math.min(1, Math.max(0, confidence));
    const raw_instruction = typeof j.raw_instruction === "string" && j.raw_instruction.trim().length > 0
        ? j.raw_instruction
        : fallbackText;
    const pcfRaw = j.partial_close_fraction;
    let partial_close_fraction;
    if (pcfRaw != null && pcfRaw !== "") {
        const n = Number(pcfRaw);
        if (Number.isFinite(n) && n > 0 && n <= 1)
            partial_close_fraction = n;
    }
    const re_enter = j.re_enter === true || (0, signalPriceInference_1.detectReEnterIntent)(raw_instruction);
    const provider_signal_number = numOrNull(j.provider_signal_number);
    const tpUnitRaw = typeof j.tp_unit === 'string' ? j.tp_unit.trim().toLowerCase() : '';
    const slUnitRaw = typeof j.sl_unit === 'string' ? j.sl_unit.trim().toLowerCase() : '';
    const tp_unit = tpUnitRaw === 'pips' || tpUnitRaw === 'price' ? tpUnitRaw : undefined;
    const sl_unit = slUnitRaw === 'pips' || slUnitRaw === 'price' ? slUnitRaw : undefined;
    return {
        action,
        symbol,
        entry_price: numOrNull(j.entry_price),
        entry_zone_low: numOrNull(j.entry_zone_low),
        entry_zone_high: numOrNull(j.entry_zone_high),
        sl: numOrNull(j.sl),
        tp,
        ...(tp_unit ? { tp_unit } : {}),
        ...(sl_unit ? { sl_unit } : {}),
        lot_size: numOrNull(j.lot_size),
        confidence,
        raw_instruction,
        open_tp: Boolean(j.open_tp ?? detectOpenTp(fallbackText)),
        ...(partial_close_fraction != null ? { partial_close_fraction } : {}),
        ...(re_enter ? { re_enter: true } : {}),
        ...(provider_signal_number != null ? { provider_signal_number } : {}),
    };
}
const ENTRY_KW = /\b(buy|sell|long|short)\b/i;
function wantsExplicitFullClose(message, kwClose, channelKeywords, lexicon) {
    if ((0, signalManagementIntent_1.looksLikeExplicitFullCloseCommand)(message, { channelKeywords, lexicon }))
        return true;
    return hasAnyKeyword(message, kwClose);
}
/** Stop-loss labels used in management updates (providers often say "risk" or "stoploss"). */
const SL_TEXT_LABELS = 'sl|stop\\s*loss|stoploss|risk|وقف\\s*الخسارة|وقف';
const TP_TEXT_LABELS = 'tp|take\\s*profit|target|الهدف(?:\\s*(?:الأول|الثاني|الثالث|\\d+))?|جني\\s*الأرباح';
const SL_MGMT_VERBS = 'set|move|adjust|bring|change|update|make|modify';
function parseAtPriceExcludingSlTp(text) {
    for (const m of text.matchAll(new RegExp(`@\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'gi'))) {
        const start = m.index ?? 0;
        const before = text.slice(Math.max(0, start - 32), start);
        if (/\b(?:sl|stop\s*loss|stoploss|tp|take\s*profit)\b[_\s./]*$/i.test(before))
            continue;
        if (/\bsl\b[_\s]*\/\s*@?\s*$/i.test(before))
            continue;
        const value = (0, signalPriceFormat_1.parseSignalPriceToken)(m[1] ?? '');
        if (value != null)
            return value;
    }
    return null;
}
function entryZoneFromRawTokens(rawA, rawB) {
    const zone = (0, signalPriceInference_1.normalizeEntryZonePair)(rawA, rawB);
    if (!zone)
        return null;
    return { entry_zone_low: zone.low, entry_zone_high: zone.high };
}
function slPriceFromClause(clause) {
    const slClauseTo = clause.match(new RegExp(`(?:\\bto\\b|إلى)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'iu'));
    if (slClauseTo?.[1])
        return (0, signalPriceFormat_1.parseSignalPriceToken)(slClauseTo[1]);
    const candidates = (0, signalManagementIntent_1.bareTradePricesExcludingPips)(clause, (0, signalPriceInference_1.extractUnlabeledPrices)(clause));
    const tail = candidates.length > 0 ? candidates[candidates.length - 1] : null;
    if (tail != null && Number.isFinite(tail) && tail > 0)
        return tail;
    return null;
}
function looksLikeStopOrTpAdjustCommand(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    return (new RegExp(`\\b(?:${SL_MGMT_VERBS})\\s+(?:${SL_TEXT_LABELS}|${TP_TEXT_LABELS})\\b`, 'i').test(t)
        || new RegExp(`\\b(?:${SL_TEXT_LABELS}|${TP_TEXT_LABELS})\\s*(?:to|=)\\s*\\d`, 'i').test(t));
}
function parseSlFromText(text) {
    const slSlashAt = text.match(/(?:^|\s)(?:sl|stop\s*loss|stoploss)[_\s]*\/\s*@\s*(\d+(?:\.\d+)?)/i);
    if (slSlashAt?.[1])
        return (0, signalPriceFormat_1.parseSignalPriceToken)(slSlashAt[1]);
    const slDotLabel = text.match(/\b(?:sl|stop\s*loss)\b\s*\.\s*(\d+(?:\.\d+)?)/i);
    if (slDotLabel?.[1])
        return (0, signalPriceFormat_1.parseSignalPriceToken)(slDotLabel[1]);
    const slMatchStandard = text.match(new RegExp(`\\b(?:${SL_TEXT_LABELS})\\s*[:=@]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'i'));
    if (slMatchStandard?.[1])
        return (0, signalPriceFormat_1.parseSignalPriceToken)(slMatchStandard[1]);
    const slMatchTo = text.match(new RegExp(`\\b(?:${SL_TEXT_LABELS})\\s+(?:to|إلى)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'iu'));
    if (slMatchTo?.[1])
        return (0, signalPriceFormat_1.parseSignalPriceToken)(slMatchTo[1]);
    // "Adjust Risk/SL/Stoploss … (+ pips) … to 4505"
    const mgmtAdjust = text.match(new RegExp(`\\b(?:${SL_MGMT_VERBS})\\s+(?:${SL_TEXT_LABELS})\\b([^\\n\\r]{0,120})`, 'i'));
    if (mgmtAdjust?.[1]) {
        const fromMgmt = slPriceFromClause(mgmtAdjust[1]);
        if (fromMgmt != null)
            return fromMgmt;
    }
    // Handles verbose updates like "Adjust SL + 20 pips for now to 4505".
    const slClause = text.match(new RegExp(`\\b(?:${SL_TEXT_LABELS})\\b([^\\n\\r]{0,96})`, 'i'))?.[1] ?? '';
    if (slClause) {
        const fromClause = slPriceFromClause(slClause);
        if (fromClause != null)
            return fromClause;
    }
    return null;
}
function parseDeterministicManagement(message, lexicon, channelKeywords) {
    const t = message.replace(/\s+/g, " ").trim();
    if (!t)
        return null;
    if ((0, signalManagementIntent_1.looksLikeStructuredEntrySignal)(t))
        return null;
    const tl = t.toLowerCase();
    const sym = (0, tradableSymbol_1.extractTradableSymbolFromMessage)(t);
    let action = null;
    let partial_close_fraction;
    let confidence = 0.92;
    const delim = channelKeywords.additional.delimiters;
    const legacyMgmt = (0, trainingManagementKeywords_1.resolveManagementGroups)({
        management_cues: lexicon?.action_aliases?.modify ?? [],
    });
    const kwClose = [
        ...splitKeywordAliases(channelKeywords.update.close_full, delim),
        ...splitKeywordAliases(channelKeywords.additional.close_all, delim),
        ...legacyMgmt.close_all,
    ];
    const kwCloseHalf = splitKeywordAliases(channelKeywords.update.close_half, delim);
    const kwClosePartialOnly = splitKeywordAliases(channelKeywords.update.close_partial, delim);
    const kwCloseTpTiers = [
        ...splitKeywordAliases(channelKeywords.update.close_tp1, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp2, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp3, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp4, delim),
    ];
    const kwPartial = [...kwCloseHalf, ...kwClosePartialOnly, ...kwCloseTpTiers];
    const kwBreakeven = [
        ...splitKeywordAliases(channelKeywords.update.break_even, delim),
        ...legacyMgmt.break_even,
    ];
    const kwCloseWorse = splitKeywordAliases(channelKeywords.update.close_worse_entries, delim);
    const kwModify = [
        ...splitKeywordAliases(channelKeywords.update.set_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp1, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp2, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp3, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp4, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp5, delim),
        ...splitKeywordAliases(channelKeywords.additional.remove_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.delete, delim),
        ...splitKeywordAliases(channelKeywords.additional.delete_all, delim),
    ];
    const hitCloseHalfKw = hasAnyKeyword(t, kwCloseHalf);
    const hitClosePartialKw = hasAnyKeyword(t, kwClosePartialOnly);
    const hitCloseTpTierKw = hasAnyKeyword(t, kwCloseTpTiers);
    const wantsPartialHalf = hitCloseHalfKw ||
        hitClosePartialKw ||
        hitCloseTpTierKw ||
        multilingualManagementTerms_1.COMMON_PARTIAL_CLOSE_PHRASES.some(p => (0, multilingualSignalTerms_1.messageContainsKeyword)(t, p)) ||
        /\b(close\s+partials?|close\s+half|close\s+50%|take\s+partials?|take\s+half|take\s+50%|c\s+half|half\s+of\s+(the\s+)?(position|trade))\b/i.test(t) ||
        /\b(closing\s+partial|close\s+partial\s+(?:lot|lots|lotsize|position|trade))\b/i.test(t) ||
        /\bsecure\s+\d+\s*%\s*profit/i.test(t) ||
        /\btake\s+profit\s+(?:target\s+)?(?:is\s+)?hit\b/i.test(t) ||
        /\b(50|half)\s*%?\s*(of\s+)?(the\s+)?(position|trade|lot|profit)\b/i.test(t) ||
        /\b(25|quarter|30|40|75)\s*%?\s*(of\s+)?(the\s+)?(position|trade|lot|profit)\b/i.test(tl) ||
        hasAnyKeyword(t, kwPartial);
    const wantsBreakeven = multilingualManagementTerms_1.COMMON_BREAKEVEN_PHRASES.some(p => (0, multilingualSignalTerms_1.messageContainsKeyword)(t, p)) ||
        /\bbreakeven|break\s*even\b/i.test(t) ||
        /\bmove\s+stop\s+to\s+(?:breakeven|break\s*even|entry|be)\b/i.test(t) ||
        /\bmoved?\s+(sl\s+)?to\s+(be|entry|entr(y)?\s?price)|\b(be|bk)\s*now\b/i.test(t) ||
        /\bstop\s*loss\s+to\s+(be|entry|breakeven|break\s*even)\b/i.test(t) ||
        /\b(?:sl|stop)\s+to\s+(be|entry|breakeven|break\s*even)\b/i.test(t) ||
        /\bmove\s+.*\b(stop\s*loss|sl|stop)\b.*\b(breakeven|break\s*even|entry|be)\b/i.test(t) ||
        hasAnyKeyword(t, kwBreakeven);
    const wantsCloseWorseEntries = /\bclose\s+worse\s+entr(?:y|ies)\b/i.test(t) ||
        /\bclose\s+worse\b/i.test(t) ||
        hasAnyKeyword(t, kwCloseWorse);
    const resolvePartialFraction = () => {
        if (hitCloseHalfKw ||
            /\b(close\s+half|take\s+half|close\s+50%|take\s+50%|c\s+half|half\s+of\s+(the\s+)?(position|trade))\b/i.test(t) ||
            /\b(50|half)\s*%?\s*(of\s+)?(the\s+)?(position|trade|lot|profit)\b/i.test(t)) {
            return 0.5;
        }
        if (hitClosePartialKw ||
            /\b(close\s+partials?|take\s+partials?|close\s+25%|take\s+25%)\b/i.test(t) ||
            /\b(25|quarter)\s*%?\s*(of\s+)?(the\s+)?(position|trade|lot|profit)\b/i.test(tl)) {
            return 0.25;
        }
        return (0, signalManagementIntent_1.partialCloseFractionFromMessage)(t);
    };
    if (wantsCloseWorseEntries) {
        action = "close_worse_entries";
        confidence = 0.95;
    }
    else if (wantsPartialHalf && wantsBreakeven) {
        action = "partial_breakeven";
        partial_close_fraction = resolvePartialFraction() ?? 0.5;
    }
    else if (wantsPartialHalf) {
        action = "partial_profit";
        const frac = resolvePartialFraction();
        if (frac != null)
            partial_close_fraction = frac;
    }
    else if (wantsBreakeven)
        action = "breakeven";
    else if (wantsExplicitFullClose(t, kwClose, channelKeywords, lexicon)) {
        if ((0, signalManagementIntent_1.looksLikeConditionalCloseSuggestion)(t))
            return null;
        action = "close";
    }
    else if (looksLikeStopOrTpAdjustCommand(t) || hasAnyKeyword(t, kwModify)) {
        action = "modify";
        confidence = 0.95;
    }
    if (!action)
        return null;
    const looksEntry = ENTRY_KW.test(t) &&
        /\b(buy|sell)\s+(now|btc|bitcoin|gold|xau)|market\s+(buy|sell)/i.test(t);
    if (action === "close" && /\b(stop\s*sell|sell\s*stops?)\s+now\b/i.test(tl))
        return null;
    if (action === "close" && looksEntry && /\b(and|&)+\s*(gold|btc)\b/i.test(tl)) {
        confidence = 0.88;
    }
    const slPriceLabels = slLabelsForChannel(channelKeywords);
    let sl = parseSlFromText(t);
    if (sl == null)
        sl = extractPriceByLabels(t, slPriceLabels);
    const extraTp = tpLabelsForChannel(channelKeywords, lexicon);
    const tpExtract = extractTpLevels(t, extraTp);
    const tp = tpExtract.values;
    return {
        action,
        symbol: sym,
        entry_price: null,
        entry_zone_low: null,
        entry_zone_high: null,
        sl,
        tp,
        ...(tpExtract.explicitPips ? { tp_unit: 'pips' } : {}),
        lot_size: null,
        confidence,
        raw_instruction: message,
        open_tp: detectOpenTp(message),
        ...((action === "partial_profit" || action === "partial_breakeven") && partial_close_fraction != null
            ? { partial_close_fraction }
            : {}),
    };
}
/**
 * Pulls entry price / zone from common channel text patterns (ENTRY 2650, @2650, zones, etc.).
 * Shared so "BUY … NOW / MARKET" and "BUY … SYMBOL PRICE" (no market word) still retain an anchor when the line lists one.
 */
function extractOptionalEntryAnchor(message, channelKeywords) {
    const text = message.replace(/\s+/g, " ").trim();
    const delim = channelKeywords.additional.delimiters;
    const zone = text.match(new RegExp(`\\b(?:between|from)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s+(?:and|to|-|–)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
    let entry_zone_low = null;
    let entry_zone_high = null;
    let entry_price = null;
    if (zone?.[1] && zone?.[2]) {
        const normalized = entryZoneFromRawTokens(zone[1], zone[2]);
        if (normalized) {
            entry_zone_low = normalized.entry_zone_low;
            entry_zone_high = normalized.entry_zone_high;
        }
    }
    else {
        const applyZone = (rawA, rawB) => {
            const normalized = entryZoneFromRawTokens(rawA, rawB);
            if (normalized) {
                entry_zone_low = normalized.entry_zone_low;
                entry_zone_high = normalized.entry_zone_high;
            }
        };
        // ZN / ZONE / Z: 4105-4113 (common shorthand on gold channels)
        const znZone = text.match(new RegExp(`\\b(?:zn|zone|z)\\s*[:=]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:-|–|to)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const nowZone = text.match(new RegExp(`\\b(?:now|instant|market|mkt)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:-|–|to)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const reentryZone = text.match(new RegExp(`\\b(?:now\\s+)?(?:re[-\\s]?entry|reenter)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:-|–|to)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const zoneMatch = znZone ?? nowZone ?? reentryZone;
        const symSideColonSlash = text.match(new RegExp(`\\b(?:xauusd|xagusd|gold|silver|btcusd|btcusdt|ethusd|ethusdt|eurusd|gbpusd|usdjpy|us30|nas100|[a-z]{6})\\s+(?:buy|sell|long|short)\\s*:\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:\\/|\\band\\b)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const symPriceSlash = text.match(new RegExp(`\\b(?:xauusd|xagusd|gold|silver)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:\\/|\\band\\b)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const sidePriceSlash = text.match(new RegExp(`\\b(?:buy|sell|long|short)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:\\/|\\band\\b)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const slashZone = symSideColonSlash ?? symPriceSlash ?? sidePriceSlash;
        const entrySlashZone = text.match(new RegExp(`\\bentry\\s*(?:price|level)?\\s*[:=]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:\\/|\\band\\b|-|–)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
        const arEntryZone = text.match(new RegExp(`(?:منطقة\\s*الدخول|نقطة\\s*الدخول|سعر\\s*الدخول)\\s*[:：]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\s*(?:-|–|to|إلى)\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})`, 'iu'));
        const bareZone = (0, signalPriceInference_1.extractBarePriceRangeZone)(message);
        if (zoneMatch?.[1] && zoneMatch?.[2]) {
            applyZone(zoneMatch[1], zoneMatch[2]);
        }
        else if (slashZone?.[1] && slashZone?.[2]) {
            applyZone(slashZone[1], slashZone[2]);
        }
        else if (entrySlashZone?.[1] && entrySlashZone?.[2]) {
            applyZone(entrySlashZone[1], entrySlashZone[2]);
        }
        else if (arEntryZone?.[1] && arEntryZone?.[2]) {
            applyZone(arEntryZone[1], arEntryZone[2]);
        }
        else if (bareZone) {
            entry_zone_low = bareZone.low;
            entry_zone_high = bareZone.high;
        }
        if (entry_zone_low == null) {
            const entryLevel = text.match(new RegExp(`\\bentry\\s+level\\s*[:=]?\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
            if (entryLevel?.[1])
                entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(entryLevel[1]);
            const entryLabel = text.match(new RegExp(`\\bentry\\s*(?:price|level)?\\s*[:=]\\s*(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
            if (entry_price == null && entryLabel?.[1])
                entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(entryLabel[1]);
            if (entry_price == null) {
                const atPx = parseAtPriceExcludingSlTp(text);
                if (atPx != null)
                    entry_price = atPx;
            }
            if (entry_price == null) {
                const buySellAt = text.match(new RegExp(`\\b(?:buy|sell)\\s+at\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
                if (buySellAt?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(buySellAt[1]);
            }
            if (entry_price == null) {
                const symbolSidePrice = text.match(new RegExp(`\\b(?:xauusd|xagusd|gold|silver|btcusd|btcusdt|ethusd|ethusdt|eurusd|gbpusd|usdjpy|us30|nas100|[a-z]{6})\\s+(?:buy|sell|long|short)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
                if (symbolSidePrice?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(symbolSidePrice[1]);
            }
            if (entry_price == null) {
                const sidePrice = text.match(new RegExp(`\\b(?:buy|sell|long|short)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
                if (sidePrice?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(sidePrice[1]);
            }
            if (entry_price == null) {
                const entryWord = text.match(new RegExp(`\\bentry\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
                if (entryWord?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(entryWord[1]);
            }
            if (entry_price == null) {
                const entryLabels = entryLabelsForChannel(channelKeywords);
                const fromKw = extractPriceByLabels(text, entryLabels);
                if (fromKw != null && Number.isFinite(fromKw) && fromKw > 0) {
                    entry_price = fromKw;
                }
            }
            // Common signal shapes that omit "entry" / "@" labels but still carry a single anchor:
            //   "BUY XAUUSD NOW 2650", "BUY GOLD 2645.5 MARKET", "SELL BTCUSD 98000 NOW",
            //   "BUY XAUUSD 2650" / "SELL GOLD 2645.5" (market word optional — same anchor as with NOW).
            if (entry_price == null && entry_zone_low == null) {
                const symPriceOptionalMarket = text.match(new RegExp(`\\b(?:xauusd|xagusd|gold|silver|btcusd|btcusdt|ethusd|ethusdt|eurusd|gbpusd|usdjpy|us30|nas100)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})(?:\\s+(?:now|instant|market|mkt))?\\b`, 'i'));
                if (symPriceOptionalMarket?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(symPriceOptionalMarket[1]);
            }
            if (entry_price == null && entry_zone_low == null) {
                const marketThenPrice = text.match(new RegExp(`\\b(?:now|instant|market|mkt)\\s+(${signalPriceFormat_1.SIGNAL_PRICE_NUM})\\b`, 'i'));
                if (marketThenPrice?.[1])
                    entry_price = (0, signalPriceFormat_1.parseSignalPriceToken)(marketThenPrice[1]);
            }
        }
    }
    return { entry_price, entry_zone_low, entry_zone_high };
}
function extractSlFromMessage(message, channelKeywords) {
    const text = message.replace(/\s+/g, ' ').trim();
    const delim = channelKeywords.additional.delimiters;
    const slPriceLabels = [
        ...splitKeywordAliases(channelKeywords.signal.sl, delim),
        ...splitKeywordAliases(channelKeywords.update.set_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_sl, delim),
    ];
    let sl = parseSlFromText(text);
    if (sl == null) {
        const fromLabel = extractPriceByLabels(text, slPriceLabels);
        sl = fromLabel != null && fromLabel > 0 ? fromLabel : null;
    }
    return sl;
}
function buildExtraTpLabels(lexicon, channelKeywords) {
    const delim = channelKeywords.additional.delimiters;
    return [
        ...(lexicon?.tp_aliases ?? []),
        ...(lexicon?.target_aliases ?? []),
        ...splitKeywordAliases(channelKeywords.signal.tp, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_tp, delim),
    ];
}
function hasParameterEvidence(message, channelKeywords) {
    if ((0, signalManagementIntent_1.looksLikeChannelManagementUpdate)(message))
        return false;
    const text = message.replace(/\s+/g, ' ').trim();
    const delim = channelKeywords.additional.delimiters;
    if (extractSlFromMessage(message, channelKeywords) != null)
        return true;
    if (extractTpLevels(message, buildExtraTpLabels(null, channelKeywords)).values.length > 0)
        return true;
    if (/\bentry\s*(?:price)?\s*[:=]\s*\d/i.test(text))
        return true;
    if (new RegExp(`@\\s*${signalPriceFormat_1.SIGNAL_PRICE_NUM}`).test(text))
        return true;
    if (hasEntryPointPriceEvidence(message, splitKeywordAliases(channelKeywords.signal.entry_point, delim))) {
        return true;
    }
    const bare = (0, signalManagementIntent_1.bareTradePricesExcludingPips)(message, (0, signalPriceInference_1.extractUnlabeledPrices)(message));
    return bare.length > 0;
}
function messageHasSideKeywords(message, channelKeywords, lexicon = null) {
    const buyAliases = buyAliasesForChannel(channelKeywords, lexicon);
    const sellAliases = sellAliasesForChannel(channelKeywords, lexicon);
    return parseBuySideFromKeywords(message, buyAliases) !== parseSellSideFromKeywords(message, sellAliases);
}
/** Symbol-less SL/TP/entry parameter posts (typical channel follow-up without repeating instrument). */
function parseChannelParameterFollowUp(message, lexicon, channelKeywords) {
    if (!hasParameterEvidence(message, channelKeywords))
        return null;
    if ((0, tradableSymbol_1.extractTradableSymbolFromMessage)(message) && !(0, signalPriceInference_1.detectReEnterIntent)(message))
        return null;
    if (messageHasSideKeywords(message, channelKeywords, lexicon) && !(0, signalPriceInference_1.detectReEnterIntent)(message))
        return null;
    const extraTp = buildExtraTpLabels(lexicon, channelKeywords);
    const sl = extractSlFromMessage(message, channelKeywords);
    const tpExtract = extractTpLevels(message, extraTp);
    const tp = tpExtract.values;
    const { entry_price, entry_zone_low, entry_zone_high } = extractOptionalEntryAnchor(message, channelKeywords);
    const reEnter = (0, signalPriceInference_1.detectReEnterIntent)(message);
    const unitFields = {
        ...(tpExtract.explicitPips ? { tp_unit: 'pips' } : {}),
    };
    if (reEnter) {
        const side = resolveTradeSideFromMessage(message, channelKeywords, lexicon);
        if (!side)
            return null;
        return {
            action: side,
            symbol: null,
            entry_price,
            entry_zone_low,
            entry_zone_high,
            sl,
            tp,
            ...unitFields,
            lot_size: null,
            confidence: 0.91,
            raw_instruction: message,
            open_tp: detectOpenTp(message),
            re_enter: true,
        };
    }
    return {
        action: 'modify',
        symbol: null,
        entry_price,
        entry_zone_low,
        entry_zone_high,
        sl,
        tp,
        ...unitFields,
        lot_size: null,
        confidence: 0.9,
        raw_instruction: message,
        open_tp: detectOpenTp(message),
    };
}
function applyDirectionalPriceInference(parsed, rawMessage) {
    const action = String(parsed.action ?? '').toLowerCase();
    if (action !== 'buy' && action !== 'sell')
        return parsed;
    // Pip-offset ladders must not be reclassified as absolute SL/TP prices.
    if (parsed.tp_unit === 'pips' || parsed.sl_unit === 'pips')
        return parsed;
    if ((0, signalStopUnits_1.tpClauseHasExplicitPips)(rawMessage))
        return parsed;
    const hasSl = typeof parsed.sl === 'number' && Number.isFinite(parsed.sl) && parsed.sl > 0;
    const hasTp = (parsed.tp ?? []).some(t => typeof t === 'number' && Number.isFinite(t) && t > 0);
    if (hasSl && hasTp)
        return parsed;
    const bare = (0, signalManagementIntent_1.bareTradePricesExcludingPips)(rawMessage, (0, tradableSymbol_1.filterPlausibleInstrumentPrices)(parsed.symbol, (0, signalPriceInference_1.extractUnlabeledPrices)(rawMessage)));
    if (!bare.length)
        return parsed;
    const classified = (0, signalPriceInference_1.classifyPricesByDirection)(action, (0, signalPriceInference_1.entryReferenceFromParsed)(parsed), bare);
    return {
        ...parsed,
        sl: hasSl ? parsed.sl : (classified.sl ?? parsed.sl),
        tp: hasTp ? parsed.tp : (classified.tp.length ? classified.tp : parsed.tp),
    };
}
function applyReEnterFlag(parsed, rawMessage) {
    if (parsed.re_enter === true)
        return parsed;
    if (!(0, signalPriceInference_1.detectReEnterIntent)(rawMessage))
        return parsed;
    return { ...parsed, re_enter: true };
}
function parseSimpleSignal(message, lexicon, channelKeywords) {
    if ((0, signalCommentaryGuard_1.looksLikeCasualNonTradeMessage)(message))
        return null;
    const text = message.toLowerCase().replace(/\s+/g, " ").trim();
    if (!text)
        return null;
    const delim = channelKeywords.additional.delimiters;
    const buyAliases = buyAliasesForChannel(channelKeywords, lexicon);
    const sellAliases = sellAliasesForChannel(channelKeywords, lexicon);
    const marketAliases = Array.from(new Set([
        'now', 'instant', 'market', 'mkt',
        ...multilingualSignalTerms_1.COMMON_MARKET_NOW_TERMS,
        ...splitKeywordAliases(channelKeywords.signal.market_order, delim),
    ]));
    const mgmtAliases = [
        ...splitKeywordAliases(channelKeywords.update.close_full, delim),
        ...splitKeywordAliases(channelKeywords.update.close_half, delim),
        ...splitKeywordAliases(channelKeywords.update.close_partial, delim),
        ...splitKeywordAliases(channelKeywords.update.break_even, delim),
        ...splitKeywordAliases(channelKeywords.update.set_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.delete, delim),
        ...splitKeywordAliases(channelKeywords.additional.close_all, delim),
        ...splitKeywordAliases(channelKeywords.additional.delete_all, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp1, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp2, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp3, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp4, delim),
    ];
    if (!(0, signalManagementIntent_1.looksLikeStructuredEntrySignal)(message) && (/\b(flatten|exit\s+trade|breakeven|break\s+even|partial|move\s+(?:sl|tp|risk|stop\s*loss|stoploss))\b/i.test(text)
        || looksLikeStopOrTpAdjustCommand(message)
        || (0, signalManagementIntent_1.looksLikeExplicitFullCloseCommand)(message)
        || hasAnyKeyword(message, mgmtAliases))) {
        return null;
    }
    const side = resolveTradeSideFromMessage(message, channelKeywords, lexicon);
    if (!side)
        return null;
    const isNow = parseSideFromKeywords(message, marketAliases);
    const atMarketLike = /\b(at\s+market|@\s*market)\b/i.test(message);
    const entryAnchor = extractOptionalEntryAnchor(message, channelKeywords);
    const hasExplicitEntry = entryAnchor.entry_price != null ||
        (entryAnchor.entry_zone_low != null && entryAnchor.entry_zone_high != null);
    if (!isNow && !atMarketLike && !hasExplicitEntry)
        return null;
    const instrument = (0, tradableSymbol_1.extractTradableSymbolFromMessage)(message);
    if (!instrument)
        return null;
    const hasInstrumentContext = (0, tradableSymbol_1.isTradableInstrumentSymbol)(instrument) ||
        /\b(gold|xau|xauusd|btc|bitcoin|btcusd|btcusdt|eth|ethereum|silver|eur|gbp|ذهب)\b/i.test(text) ||
        /\bEUR\/USD|EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSD|BTCUSDT\b/i.test(message) ||
        /\b(us30|nas100|ger40|uk100|ustec|spx500|spy|qqq|iwm|dia|voo|tqqq|gld|slv)\b/i.test(text) ||
        /\bmarket\s*:\s*[A-Za-z]/i.test(message) ||
        DERIV_SYNTHETIC_HINT_RE.test(text);
    if (!hasInstrumentContext)
        return null;
    const sl = parseSlFromText(text) ?? extractPriceByLabels(message, slLabelsForChannel(channelKeywords, false));
    const tpExtract = extractTpLevels(message, tpLabelsForChannel(channelKeywords, lexicon, false));
    const tp = tpExtract.values;
    const { entry_price, entry_zone_low, entry_zone_high } = entryAnchor;
    return {
        action: side,
        symbol: instrument,
        entry_price,
        entry_zone_low,
        entry_zone_high,
        sl,
        tp,
        ...(tpExtract.explicitPips ? { tp_unit: 'pips' } : {}),
        lot_size: null,
        confidence: 0.99,
        raw_instruction: message,
        open_tp: detectOpenTp(message),
    };
}
/** Entry when channel BUY/SELL + instrument + at least one price level appear (no “market” word required). */
function parseEntryFromKeywords(message, lexicon, channelKeywords) {
    if ((0, signalCommentaryGuard_1.looksLikeCasualNonTradeMessage)(message))
        return null;
    const text = message.replace(/\s+/g, " ").trim();
    if (!text)
        return null;
    const delim = channelKeywords.additional.delimiters;
    const buyAliases = buyAliasesForChannel(channelKeywords, lexicon);
    const sellAliases = sellAliasesForChannel(channelKeywords, lexicon);
    const mgmtAliases = [
        ...splitKeywordAliases(channelKeywords.update.close_full, delim),
        ...splitKeywordAliases(channelKeywords.update.close_half, delim),
        ...splitKeywordAliases(channelKeywords.update.close_partial, delim),
        ...splitKeywordAliases(channelKeywords.update.break_even, delim),
        ...splitKeywordAliases(channelKeywords.update.set_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_sl, delim),
        ...splitKeywordAliases(channelKeywords.update.set_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.adjust_tp, delim),
        ...splitKeywordAliases(channelKeywords.update.delete, delim),
        ...splitKeywordAliases(channelKeywords.additional.close_all, delim),
        ...splitKeywordAliases(channelKeywords.additional.delete_all, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp1, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp2, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp3, delim),
        ...splitKeywordAliases(channelKeywords.update.close_tp4, delim),
    ];
    if (hasAnyKeyword(message, mgmtAliases) && !(0, signalManagementIntent_1.looksLikeStructuredEntrySignal)(message))
        return null;
    const isBuy = parseBuySideFromKeywords(message, buyAliases);
    const isSell = parseSellSideFromKeywords(message, sellAliases);
    if (!isBuy && isSell && /\bshort\s+of\b/i.test(text))
        return null;
    if (isBuy === isSell)
        return null;
    const instrument = (0, tradableSymbol_1.extractTradableSymbolFromMessage)(message);
    if (!instrument)
        return null;
    const slPriceLabels = slLabelsForChannel(channelKeywords, false);
    let sl = parseSlFromText(text);
    if (sl == null || !Number.isFinite(sl))
        sl = extractPriceByLabels(text, slPriceLabels);
    const tpExtract = extractTpLevels(message, tpLabelsForChannel(channelKeywords, lexicon, false));
    const tp = tpExtract.values;
    const entryAliases = entryLabelsForChannel(channelKeywords);
    const entryPointHit = hasEntryPointPriceEvidence(message, entryAliases);
    const hasPriceEvidence = entryPointHit ||
        (sl != null && Number.isFinite(sl)) ||
        tp.length > 0 ||
        /\b(limit|pending|@)\b/i.test(text) ||
        (0, tradableSymbol_1.filterPlausibleInstrumentPrices)(instrument, (0, signalManagementIntent_1.bareTradePricesExcludingPips)(message, (0, signalPriceInference_1.extractUnlabeledPrices)(message))).length > 0;
    if (!hasPriceEvidence)
        return null;
    const { entry_price, entry_zone_low, entry_zone_high } = extractOptionalEntryAnchor(message, channelKeywords);
    return {
        action: isBuy ? "buy" : "sell",
        symbol: instrument,
        entry_price,
        entry_zone_low,
        entry_zone_high,
        sl,
        tp,
        ...(tpExtract.explicitPips ? { tp_unit: 'pips' } : {}),
        lot_size: null,
        confidence: 0.93,
        raw_instruction: message,
        open_tp: detectOpenTp(message),
    };
}
const MGMT_NON_INSTRUMENT_SYMBOLS = new Set([
    "CHANGE", "CHANGED", "UPDATE", "UPDATED", "MODIFY", "MODIFIED", "ADJUST", "MOVE", "MOVED",
    "CLOSE", "CLOSED", "SIGNAL", "SETUP", "ENTRY", "ZONE", "TRADE", "ORDER", "POSITION",
]);
function applyQuoteLevelSymbolRepair(parsed, rawMsg) {
    const symbol = (0, tradableSymbol_1.reconcileSymbolWithQuoteLevels)(parsed.symbol, rawMsg, {
        sl: parsed.sl,
        tp: parsed.tp,
        entry: parsed.entry_price,
    });
    if (symbol && symbol !== parsed.symbol) {
        return { ...parsed, symbol };
    }
    return parsed;
}
function applyRawSymbolRepair(parsed, rawMsg) {
    const extracted = (0, tradableSymbol_1.extractTradableSymbolFromMessage)(rawMsg);
    const cur = parsed.symbol?.toUpperCase().replace(/\s/g, "") ?? "";
    const curMentioned = cur ? new RegExp(`\\b${cur}\\b`, "i").test(rawMsg.replace(/\s+/g, "")) : false;
    const signalBody = (0, tradableSymbol_1.signalBodyBeforePromoFooter)(rawMsg);
    const goldHints = /\b(gold|xau|xauusd)\b/i.test(signalBody);
    const btcHints = /\b(btc|bitcoin|btcusd|btcusdt)\b/i.test(signalBody);
    const hasAnySymbolHint = /([A-Z]{3,}\/[A-Z]{3,})|\b([A-Z]{6}|XAUUSD|XAGUSD|BTCUSD|BTCUSDT|ETHUSD|ETHUSDT)\b|(\bgold\b|\bxau\b|\bbtc\b|\bbitcoin\b|\beth\b|\bether)\b/i
        .test(rawMsg) || DERIV_SYNTHETIC_HINT_RE.test(rawMsg);
    const mgmt = new Set([
        "close",
        "close_worse_entries",
        "breakeven",
        "partial_profit",
        "partial_breakeven",
        "modify",
    ]).has(parsed.action);
    if (mgmt) {
        if (cur && MGMT_NON_INSTRUMENT_SYMBOLS.has(cur)) {
            return { ...parsed, symbol: extracted ?? null };
        }
        if (extracted)
            return { ...parsed, symbol: extracted };
        if (!hasAnySymbolHint && !curMentioned)
            return { ...parsed, symbol: null };
        if (cur === "XAUUSD" && !goldHints)
            return { ...parsed, symbol: null };
        return parsed;
    }
    if (!extracted)
        return parsed;
    if (cur === "XAUUSD" && (!goldHints && (btcHints || extracted.includes("BTC") || extracted.includes("ETH")))) {
        return { ...parsed, symbol: extracted };
    }
    if ((!cur || cur !== extracted) && (btcHints || goldHints || (0, tradableSymbol_1.isTradableInstrumentSymbol)(extracted))) {
        return { ...parsed, symbol: extracted };
    }
    return parsed;
}
function dropInvalidTradeSymbol(parsed) {
    const symbol = (0, tradableSymbol_1.sanitizeParsedSymbol)(parsed.symbol);
    const needsSymbol = (parsed.action === "buy" || parsed.action === "sell")
        && parsed.re_enter !== true;
    if (needsSymbol && !symbol) {
        return {
            ...parsed,
            symbol: null,
            action: "ignore",
            confidence: 0,
        };
    }
    if (symbol !== parsed.symbol) {
        return { ...parsed, symbol };
    }
    return parsed;
}
function ignorePayload(raw) {
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
        raw_instruction: raw,
        open_tp: false,
    };
}
async function loadChannelLexicon(supabase, channelId) {
    if (!channelId)
        return null;
    const { data } = await supabase
        .from("channel_signal_lexicon")
        .select("user_id, channel_id, action_aliases, tp_aliases, target_aliases, unknown_tokens")
        .eq("channel_id", channelId)
        .maybeSingle();
    return (data ?? null);
}
async function loadChannelKeywords(supabase, channelId) {
    if (!channelId)
        return exports.DEFAULT_CHANNEL_KEYWORDS;
    const { data } = await supabase
        .from("telegram_channels")
        .select("channel_keywords")
        .eq("id", channelId)
        .maybeSingle();
    return normalizeChannelKeywords(data?.channel_keywords);
}
var signalManagementIntent_2 = require("./signalManagementIntent");
Object.defineProperty(exports, "looksLikeChannelManagementUpdate", { enumerable: true, get: function () { return signalManagementIntent_2.looksLikeChannelManagementUpdate; } });
Object.defineProperty(exports, "looksLikeExplicitFullCloseCommand", { enumerable: true, get: function () { return signalManagementIntent_2.looksLikeExplicitFullCloseCommand; } });
function applyStopUnits(parsed, rawMessage, channelKeywords) {
    const action = String(parsed.action ?? '').toLowerCase();
    if (action !== 'buy' && action !== 'sell' && action !== 'modify')
        return parsed;
    const tps = (parsed.tp ?? []).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
    const ref = (0, signalStopUnits_1.entryRefFromParsed)(parsed);
    const tp_unit = (0, signalStopUnits_1.resolveTpUnit)({
        message: rawMessage,
        tps,
        channelTpInPips: channelKeywords?.additional?.tp_in_pips === true,
        ref,
        explicitFromExtract: parsed.tp_unit === 'pips',
    });
    const sl_unit = (0, signalStopUnits_1.resolveSlUnit)({
        message: rawMessage,
        sl: parsed.sl,
        channelSlInPips: channelKeywords?.additional?.sl_in_pips === true,
        ref: parsed.entry_price ?? parsed.entry_zone_low ?? parsed.entry_zone_high ?? null,
    });
    return {
        ...parsed,
        ...(tps.length ? { tp_unit } : {}),
        ...(parsed.sl != null && Number.isFinite(parsed.sl) ? { sl_unit } : {}),
    };
}
function enrichParsedKeywordMatch(keywordMatch, rawMessage, channelKeywords) {
    const enriched = applyReEnterFlag(applyDirectionalPriceInference(normalizeParsedFromModel(keywordMatch, rawMessage), rawMessage), rawMessage);
    const repaired = applyRawSymbolRepair(enriched, rawMessage);
    const quoteRepaired = applyQuoteLevelSymbolRepair(repaired, rawMessage);
    const dropped = dropInvalidTradeSymbol(quoteRepaired);
    const withUnits = applyStopUnits(dropped, rawMessage, channelKeywords);
    const providerNum = withUnits.provider_signal_number ?? (0, forexBroSignalPatterns_1.extractProviderSignalNumber)(rawMessage);
    if (providerNum == null)
        return withUnits;
    return { ...withUnits, provider_signal_number: providerNum };
}
/** Deterministic management / SL-TP follow-up parse only (no entry parsers). */
function parseModificationDeterministic(rawMessage, channelKeywords, lexicon) {
    const message = (0, normalizeTelegramMessageText_1.normalizeSignalMessageForParse)(rawMessage);
    const displayMessage = (0, normalizeTelegramMessageText_1.normalizeTelegramMessageText)(rawMessage);
    const ignoreAliases = [
        ...splitKeywordAliases(channelKeywords.additional.ignore_keyword, channelKeywords.additional.delimiters),
        ...splitKeywordAliases(channelKeywords.additional.skip_keyword, channelKeywords.additional.delimiters),
    ];
    const explicitIgnore = hasAnyKeyword(message, ignoreAliases);
    const keywordMatch = parseDeterministicManagement(message, lexicon, channelKeywords) ??
        parseChannelParameterFollowUp(message, lexicon, channelKeywords);
    if (explicitIgnore) {
        return {
            parsed: ignorePayload(displayMessage),
            status: 'skipped',
            skip_reason: 'Non-trade message',
        };
    }
    if (!keywordMatch) {
        return {
            parsed: {
                action: 'ignore',
                symbol: null,
                entry_price: null,
                entry_zone_low: null,
                entry_zone_high: null,
                sl: null,
                tp: [],
                lot_size: null,
                confidence: 0,
                raw_instruction: displayMessage,
                open_tp: false,
            },
            status: 'skipped',
            skip_reason: 'No matching management or parameter follow-up pattern',
        };
    }
    const parsed = enrichParsedKeywordMatch(keywordMatch, message, channelKeywords);
    const status = parsed.action === 'ignore' ? 'skipped' : 'parsed';
    const skip_reason = parsed.action === 'ignore'
        ? 'No matching management or parameter follow-up pattern'
        : null;
    return { parsed, status, skip_reason };
}
/** Normalize OpenAI JSON output into a channel parsed signal. */
function normalizeAiParsedOutput(raw, fallbackText) {
    return enrichParsedKeywordMatch(normalizeParsedFromModel(raw, fallbackText), fallbackText);
}
/** Synchronous parse when keywords/lexicon are already loaded (hot path). */
function parseChannelMessageSync(rawMessage, channelKeywords, lexicon) {
    const collapsedMessage = (0, forexBroSignalPatterns_1.collapseForexBroBilingualMessage)(rawMessage);
    const message = (0, normalizeTelegramMessageText_1.normalizeSignalMessageForParse)(collapsedMessage);
    const displayMessage = (0, normalizeTelegramMessageText_1.normalizeTelegramMessageText)(rawMessage);
    const ignoreAliases = [
        ...splitKeywordAliases(channelKeywords.additional.ignore_keyword, channelKeywords.additional.delimiters),
        ...splitKeywordAliases(channelKeywords.additional.skip_keyword, channelKeywords.additional.delimiters),
    ];
    const explicitIgnore = hasAnyKeyword(message, ignoreAliases);
    const forexBro = (0, forexBroSignalPatterns_1.parseForexBroManagementMessage)(message);
    const keywordMatch = forexBro
        ? {
            action: forexBro.action,
            symbol: forexBro.symbol,
            entry_price: forexBro.entry_price,
            entry_zone_low: forexBro.entry_zone_low,
            entry_zone_high: forexBro.entry_zone_high,
            sl: forexBro.sl,
            tp: forexBro.tp,
            lot_size: forexBro.lot_size,
            confidence: forexBro.confidence,
            raw_instruction: displayMessage,
            open_tp: forexBro.open_tp,
            ...(forexBro.provider_signal_number != null
                ? { provider_signal_number: forexBro.provider_signal_number }
                : {}),
        }
        : parseDeterministicManagement(message, lexicon, channelKeywords) ??
            parseChannelParameterFollowUp(message, lexicon, channelKeywords) ??
            parseSimpleSignal(message, lexicon, channelKeywords) ??
            parseEntryFromKeywords(message, lexicon, channelKeywords);
    const rawParsed = explicitIgnore
        ? ignorePayload(displayMessage)
        : keywordMatch ?? {
            action: "ignore",
            symbol: null,
            entry_price: null,
            entry_zone_low: null,
            entry_zone_high: null,
            sl: null,
            tp: [],
            lot_size: null,
            confidence: 0,
            raw_instruction: displayMessage,
            open_tp: false,
        };
    const dropped = enrichParsedKeywordMatch(rawParsed, message, channelKeywords);
    if ((0, signalEntryNowRequirement_1.entryMissingSlTpRequiresNow)(dropped, message, channelKeywords)) {
        return {
            parsed: {
                ...dropped,
                action: 'ignore',
                symbol: null,
                confidence: 0,
            },
            status: 'skipped',
            skip_reason: 'Entry requires NOW (or MARKET) when SL and TP are absent',
        };
    }
    const parsed = dropped;
    const status = parsed.action === "ignore" ? "skipped" : "parsed";
    const skip_reason = parsed.action === "ignore"
        ? (explicitIgnore
            ? "Non-trade message"
            : (forexBro?.skip_reason ?? "No matching channel keywords or price pattern"))
        : null;
    return { parsed, status, skip_reason };
}
/** Load channel context from DB then parse (fallback / catch-up). */
async function parseRawChannelMessage(supabase, channelId, rawMessage) {
    const lexicon = await loadChannelLexicon(supabase, channelId);
    const channelKeywords = await loadChannelKeywords(supabase, channelId);
    return parseChannelMessageSync(rawMessage, channelKeywords, lexicon);
}
