"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareParseShadowDiff = compareParseShadowDiff;
exports.intentActionLabel = intentActionLabel;
exports.intentToParsePreview = intentToParsePreview;
const tradeIntentAdapter_1 = require("./tradeIntentAdapter");
function actionOf(result) {
    return String(result.parsed.action ?? '').toLowerCase();
}
function normTp(tp) {
    if (!Array.isArray(tp))
        return [];
    return tp.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}
function compareParseShadowDiff(deterministic, universalParsed) {
    const det = deterministic.parsed;
    const uni = universalParsed.parsed;
    const diff = {
        differs: false,
        deterministic_action: actionOf(deterministic),
        universal_action: actionOf(universalParsed),
        deterministic_symbol: det.symbol ?? null,
        universal_symbol: uni.symbol ?? null,
        deterministic_sl: typeof det.sl === 'number' ? det.sl : null,
        universal_sl: typeof uni.sl === 'number' ? uni.sl : null,
        deterministic_tp: normTp(det.tp),
        universal_tp: normTp(uni.tp),
    };
    diff.differs =
        diff.deterministic_action !== diff.universal_action
            || diff.deterministic_symbol !== diff.universal_symbol
            || diff.deterministic_sl !== diff.universal_sl
            || JSON.stringify(diff.deterministic_tp) !== JSON.stringify(diff.universal_tp);
    return diff;
}
function intentActionLabel(intent) {
    if (intent.kind === 'entry') {
        return intent.side === 'BUY' ? 'buy' : intent.side === 'SELL' ? 'sell' : 'ignore';
    }
    if (intent.kind === 'modify')
        return 'modify';
    if (intent.kind === 'close')
        return 'close';
    if (intent.kind === 'breakeven')
        return 'breakeven';
    if (intent.kind === 'partial_close')
        return 'partial_profit';
    return 'ignore';
}
function intentToParsePreview(intent, rawMessage) {
    const parsed = (0, tradeIntentAdapter_1.tradeIntentToChannelParsedSignal)(intent, rawMessage);
    const isIgnore = parsed.action === 'ignore';
    return {
        parsed,
        status: isIgnore ? 'skipped' : 'parsed',
        skip_reason: isIgnore ? 'universal_intent_ignore' : null,
    };
}
