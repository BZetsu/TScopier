"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsedDataToTradeIntent = parsedDataToTradeIntent;
function numOrNull(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function actionToKindSide(action) {
    switch (action) {
        case 'buy': return { kind: 'entry', side: 'BUY' };
        case 'sell': return { kind: 'entry', side: 'SELL' };
        case 'modify': return { kind: 'modify', side: null };
        case 'close':
        case 'close_worse_entries':
            return { kind: 'close', side: null };
        case 'breakeven':
        case 'partial_breakeven':
            return { kind: 'breakeven', side: null };
        case 'partial_profit':
            return { kind: 'partial_close', side: null };
        default:
            return { kind: 'ignore', side: null };
    }
}
function parsedDataToTradeIntent(parsed) {
    const action = String(parsed?.action ?? '').toLowerCase();
    const { kind, side } = actionToKindSide(action);
    const entry = [];
    const ep = numOrNull(parsed?.entry_price);
    const lo = numOrNull(parsed?.entry_zone_low);
    const hi = numOrNull(parsed?.entry_zone_high);
    if (ep != null)
        entry.push(ep);
    else if (lo != null && hi != null)
        entry.push(Math.min(lo, hi), Math.max(lo, hi));
    const tp = Array.isArray(parsed?.tp)
        ? parsed.tp.map(numOrNull).filter((n) => n != null)
        : [];
    const confidence = typeof parsed?.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.85;
    return {
        kind,
        side,
        symbol: typeof parsed?.symbol === 'string' ? parsed.symbol : null,
        entry,
        sl: numOrNull(parsed?.sl),
        tp,
        sl_unit: 'price',
        tp_unit: 'price',
        flags: kind === 'entry' ? { re_enter: true } : {},
        confidence,
    };
}
