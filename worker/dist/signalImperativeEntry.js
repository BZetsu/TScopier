"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageHasImperativeEntryPhrase = messageHasImperativeEntryPhrase;
const signalCommentaryGuard_1 = require("./signalCommentaryGuard");
const multilingualSignalTerms_1 = require("./multilingualSignalTerms");
const signalEntryNowRequirement_1 = require("./signalEntryNowRequirement");
function splitKeywordAliases(raw, delim) {
    return String(raw ?? '').split(delim).map(s => s.trim()).filter(Boolean);
}
/** True when the message uses imperative entry wording (not prose selling/buying). */
function messageHasImperativeEntryPhrase(message, channelKeywords) {
    const raw = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!raw)
        return false;
    if ((0, signalCommentaryGuard_1.hasExecutableTradeStructure)(raw))
        return true;
    const folded = (0, multilingualSignalTerms_1.foldAccents)(raw);
    if (multilingualSignalTerms_1.BUY_NOW_COMPOUND_RE.test(folded))
        return true;
    if (multilingualSignalTerms_1.SELL_NOW_COMPOUND_RE.test(folded))
        return true;
    if ((0, multilingualSignalTerms_1.messageHasDirectionWithImmediateCue)(raw))
        return true;
    if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+now\b/i.test(raw))
        return true;
    if (/\b(?:buy|sell)\s+(?:gold|xau(?:usd)?)\s+now\b/i.test(raw))
        return true;
    const delim = channelKeywords?.additional?.delimiters ?? '|';
    const buyAliases = splitKeywordAliases(channelKeywords?.signal?.buy ?? '', delim);
    const sellAliases = splitKeywordAliases(channelKeywords?.signal?.sell ?? '', delim);
    for (const alias of [...buyAliases, ...sellAliases]) {
        if (!alias || !(0, multilingualSignalTerms_1.messageContainsKeyword)(raw, alias))
            continue;
        const words = alias.trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2)
            return true;
        if ((0, signalEntryNowRequirement_1.messageHasExplicitSlTpLabels)(raw))
            return true;
    }
    return false;
}
