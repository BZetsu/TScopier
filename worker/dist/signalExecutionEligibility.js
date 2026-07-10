"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTRY_REQUIRES_IMPERATIVE_OR_LABELED_STOPS_REASON = exports.ENTRY_MISSING_STRUCTURE_REASON = exports.COMMENTARY_NOT_SIGNAL_REASON = exports.ENTRY_REQUIRES_NOW_REASON = void 0;
exports.evaluateParsedSignalExecutionEligibility = evaluateParsedSignalExecutionEligibility;
const backtestSignal_1 = require("./backtestSignal");
const signalCommentaryGuard_1 = require("./signalCommentaryGuard");
const signalImperativeEntry_1 = require("./signalImperativeEntry");
const signalEntryNowRequirement_1 = require("./signalEntryNowRequirement");
const signalManagementIntent_1 = require("./signalManagementIntent");
const tradableSymbol_1 = require("./tradableSymbol");
var signalEntryNowRequirement_2 = require("./signalEntryNowRequirement");
Object.defineProperty(exports, "ENTRY_REQUIRES_NOW_REASON", { enumerable: true, get: function () { return signalEntryNowRequirement_2.ENTRY_REQUIRES_NOW_REASON; } });
exports.COMMENTARY_NOT_SIGNAL_REASON = 'commentary_not_trade_signal';
exports.ENTRY_MISSING_STRUCTURE_REASON = 'entry_missing_sl_tp_structure';
exports.ENTRY_REQUIRES_IMPERATIVE_OR_LABELED_STOPS_REASON = 'entry_requires_imperative_or_labeled_stops';
function evaluateParsedSignalExecutionEligibility(parsed, rawMessage, channelKeywords) {
    if (!parsed)
        return { eligible: false, skipReason: 'parsed_data_missing' };
    const action = String(parsed.action ?? '').toLowerCase();
    if (action !== 'buy' && action !== 'sell')
        return { eligible: true };
    const raw = String(rawMessage ?? parsed.raw_instruction ?? '').trim();
    if (raw) {
        if ((0, signalCommentaryGuard_1.looksLikeCasualNonTradeMessage)(raw)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
        if (/\b\d+(?:\.\d+)?\s*pips?\s+short\s+of\s+tp\d*\b/i.test(raw)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
        if ((0, signalManagementIntent_1.looksLikeChannelManagementUpdate)(raw) && action !== 'buy' && action !== 'sell'
            && !/\b(buy|sell|long|short)\b/i.test(raw)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
    }
    const imperative = (0, signalImperativeEntry_1.messageHasImperativeEntryPhrase)(raw, channelKeywords);
    const labeledStops = (0, signalEntryNowRequirement_1.messageHasExplicitSlTpLabels)(raw) && (0, signalEntryNowRequirement_1.parsedHasSlOrTp)(parsed);
    if (!imperative && !labeledStops) {
        return { eligible: false, skipReason: exports.ENTRY_REQUIRES_IMPERATIVE_OR_LABELED_STOPS_REASON };
    }
    const symbol = (0, tradableSymbol_1.sanitizeParsedSymbol)(typeof parsed.symbol === 'string' ? parsed.symbol : null);
    const minQuote = (0, tradableSymbol_1.minPlausibleQuotePrice)(symbol);
    if (minQuote != null && symbol) {
        const sl = positive(parsed.sl);
        const tps = Array.isArray(parsed.tp) ? parsed.tp.map(positive).filter((n) => n != null) : [];
        if ((sl != null && sl < minQuote) || tps.some(t => t < minQuote)) {
            return { eligible: false, skipReason: exports.COMMENTARY_NOT_SIGNAL_REASON };
        }
    }
    if (labeledStops) {
        if ((0, backtestSignal_1.tradeableFromParsed)(parsed)) {
            if ((0, signalEntryNowRequirement_1.entryMissingSlTpRequiresNow)(parsed, raw, channelKeywords)) {
                return { eligible: false, skipReason: signalEntryNowRequirement_1.ENTRY_REQUIRES_NOW_REASON };
            }
            return { eligible: true };
        }
        if (symbol && (0, signalEntryNowRequirement_1.parsedHasSlOrTp)(parsed)) {
            return { eligible: false, skipReason: exports.ENTRY_MISSING_STRUCTURE_REASON };
        }
    }
    if (imperative) {
        if (symbol || (0, backtestSignal_1.tradeableFromParsed)(parsed)) {
            if ((0, backtestSignal_1.tradeableFromParsed)(parsed) && (0, signalEntryNowRequirement_1.entryMissingSlTpRequiresNow)(parsed, raw, channelKeywords)) {
                return { eligible: false, skipReason: signalEntryNowRequirement_1.ENTRY_REQUIRES_NOW_REASON };
            }
            return { eligible: true };
        }
        return { eligible: false, skipReason: exports.ENTRY_MISSING_STRUCTURE_REASON };
    }
    if (symbol && (parsed.action === 'buy' || parsed.action === 'sell')) {
        return { eligible: false, skipReason: signalEntryNowRequirement_1.ENTRY_REQUIRES_NOW_REASON };
    }
    return { eligible: false, skipReason: exports.ENTRY_MISSING_STRUCTURE_REASON };
}
function positive(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
