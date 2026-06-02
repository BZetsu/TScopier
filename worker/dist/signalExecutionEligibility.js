"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTRY_MISSING_STRUCTURE_REASON = exports.COMMENTARY_NOT_SIGNAL_REASON = void 0;
exports.evaluateParsedSignalExecutionEligibility = evaluateParsedSignalExecutionEligibility;
const backtestSignal_1 = require("./backtestSignal");
const signalManagementIntent_1 = require("./signalManagementIntent");
const tradableSymbol_1 = require("./tradableSymbol");
exports.COMMENTARY_NOT_SIGNAL_REASON = 'commentary_not_trade_signal';
exports.ENTRY_MISSING_STRUCTURE_REASON = 'entry_missing_sl_tp_structure';
function evaluateParsedSignalExecutionEligibility(parsed, rawMessage) {
    if (!parsed)
        return { eligible: false, skipReason: 'parsed_data_missing' };
    const action = String(parsed.action ?? '').toLowerCase();
    if (action !== 'buy' && action !== 'sell')
        return { eligible: true };
    const raw = String(rawMessage ?? parsed.raw_instruction ?? '').trim();
    if (raw) {
        if (/\b\d+(?:\.\d+)?\s*pips?\s+short\s+of\s+tp\d*\b/i.test(raw)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
        if ((0, signalManagementIntent_1.looksLikeChannelManagementUpdate)(raw) && !/\b(buy|sell|long|short)\b/i.test(raw)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
    }
    if ((0, backtestSignal_1.tradeableFromParsed)(parsed))
        return { eligible: true };
    const symbol = (0, tradableSymbol_1.sanitizeParsedSymbol)(typeof parsed.symbol === 'string' ? parsed.symbol : null);
    const hasEntryAnchor = positive(parsed.entry_price) != null
        || positive(parsed.entry_zone_low) != null
        || positive(parsed.entry_zone_high) != null;
    const looksLikeMarketEntry = /\b(now|market|instant|mkt)\b/i.test(raw)
        && /\b(buy|sell|long|short)\b/i.test(raw);
    if (symbol && (hasEntryAnchor || looksLikeMarketEntry))
        return { eligible: true };
    return { eligible: false, skipReason: exports.ENTRY_MISSING_STRUCTURE_REASON };
}
function positive(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
