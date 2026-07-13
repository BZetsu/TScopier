"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTradeIntent = validateTradeIntent;
const signalCommentaryGuard_1 = require("../signalCommentaryGuard");
const tradableSymbol_1 = require("../tradableSymbol");
/** Extract numeric tokens from source text for hallucination guard. */
function sourcePriceTokens(rawMessage) {
    const tokens = new Set();
    const re = /\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(rawMessage)) != null) {
        tokens.add(m[0]);
        const n = Number(m[0]);
        if (Number.isFinite(n)) {
            tokens.add(String(n));
            if (Number.isInteger(n))
                tokens.add(String(n) + '.0');
        }
    }
    return tokens;
}
function priceAppearsInSource(value, sourceTokens) {
    const s = String(value);
    if (sourceTokens.has(s))
        return true;
    const rounded = value.toFixed(2);
    if (sourceTokens.has(rounded))
        return true;
    const int = String(Math.round(value));
    return sourceTokens.has(int);
}
function validatePricesFromSource(intent, rawMessage) {
    const tokens = sourcePriceTokens(rawMessage);
    if (!tokens.size)
        return null;
    const check = (v) => v == null || v <= 0 || priceAppearsInSource(v, tokens);
    if (!check(intent.sl))
        return 'invented_sl';
    for (const e of intent.entry) {
        if (!check(e))
            return 'invented_entry';
    }
    for (const t of intent.tp) {
        if (!check(t))
            return 'invented_tp';
    }
    return null;
}
/** Language-agnostic validation after AI extraction, before adapter. */
function validateTradeIntent(intent, rawMessage) {
    const raw = String(rawMessage ?? '').trim();
    if (!raw) {
        return { ok: false, reason: 'empty_message', intent: { ...intent, kind: 'ignore' } };
    }
    if ((0, signalCommentaryGuard_1.looksLikeCasualNonTradeMessage)(raw)) {
        return {
            ok: false,
            reason: 'commentary_not_trade_signal',
            intent: { ...intent, kind: 'commentary' },
        };
    }
    if (intent.kind === 'commentary' || intent.kind === 'ignore') {
        return { ok: true, intent };
    }
    const invented = validatePricesFromSource(intent, raw);
    if (invented) {
        return {
            ok: false,
            reason: `intent_validation_failed:${invented}`,
            intent: { ...intent, kind: 'ignore', confidence: 0 },
        };
    }
    const symbol = (0, tradableSymbol_1.sanitizeParsedSymbol)(intent.symbol);
    const normalized = {
        ...intent,
        symbol: symbol ?? intent.symbol,
    };
    if (intent.kind === 'entry' && !intent.side) {
        return {
            ok: false,
            reason: 'entry_missing_side',
            intent: { ...normalized, kind: 'ignore' },
        };
    }
    return { ok: true, intent: normalized };
}
