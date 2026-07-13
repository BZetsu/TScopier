"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coerceTradeIntent = coerceTradeIntent;
const KINDS = new Set([
    'entry', 'modify', 'close', 'breakeven', 'partial_close', 'ignore', 'commentary',
]);
function numOrNull(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function numList(v) {
    if (!Array.isArray(v))
        return [];
    return v.map(numOrNull).filter((n) => n != null);
}
function sideFromRaw(v) {
    const s = String(v ?? '').trim().toUpperCase();
    if (s === 'BUY' || s === 'LONG')
        return 'BUY';
    if (s === 'SELL' || s === 'SHORT')
        return 'SELL';
    return null;
}
function kindFromRaw(v) {
    const k = String(v ?? '').trim().toLowerCase();
    if (KINDS.has(k))
        return k;
    return 'ignore';
}
function unitFromRaw(v, fallback) {
    const u = String(v ?? '').trim().toLowerCase();
    return u === 'pips' ? 'pips' : fallback;
}
function entryFromRaw(raw) {
    const direct = numList(raw.entry);
    if (direct.length)
        return direct;
    const low = numOrNull(raw.entry_zone_low);
    const high = numOrNull(raw.entry_zone_high);
    if (low != null && high != null)
        return [Math.min(low, high), Math.max(low, high)];
    const single = numOrNull(raw.entry_price);
    return single != null ? [single] : [];
}
/** Coerce OpenAI / legacy JSON into a TradeIntent. */
function coerceTradeIntent(raw) {
    const j = (raw && typeof raw === 'object' ? raw : {});
    const flagsRaw = (j.flags && typeof j.flags === 'object' ? j.flags : j);
    const kind = kindFromRaw(j.kind ?? j.intent);
    let side = sideFromRaw(j.side ?? j.action);
    if (!side) {
        const action = String(j.action ?? '').toLowerCase();
        if (action === 'buy' || action === 'long')
            side = 'BUY';
        if (action === 'sell' || action === 'short')
            side = 'SELL';
    }
    const confidence = typeof j.confidence === 'number' && Number.isFinite(j.confidence)
        ? Math.min(1, Math.max(0, j.confidence))
        : 0.85;
    const partialFrac = numOrNull(flagsRaw.partial_close_fraction ?? j.partial_close_fraction);
    const partialNorm = partialFrac != null && partialFrac <= 1 ? partialFrac : partialFrac != null && partialFrac > 1 ? partialFrac / 100 : null;
    return {
        kind,
        side,
        symbol: typeof j.symbol === 'string' && j.symbol.trim() ? j.symbol.trim() : null,
        entry: entryFromRaw(j),
        sl: numOrNull(j.sl),
        tp: numList(j.tp),
        sl_unit: unitFromRaw(j.sl_unit, 'price'),
        tp_unit: unitFromRaw(j.tp_unit, 'price'),
        flags: {
            market_now: flagsRaw.market_now === true || j.market_now === true,
            re_enter: flagsRaw.re_enter === true || j.re_enter === true,
            open_tp: flagsRaw.open_tp === true || j.open_tp === true,
            ...(partialNorm != null ? { partial_close_fraction: partialNorm } : {}),
        },
        confidence,
        detected_language: typeof j.detected_language === 'string' ? j.detected_language : undefined,
    };
}
