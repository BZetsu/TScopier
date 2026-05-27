"use strict";
/**
 * Per-channel management filters stored on broker_accounts.channel_message_filters.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHANNEL_FILTERS = void 0;
exports.normalizeChannelFilters = normalizeChannelFilters;
exports.normalizeChannelMessageFiltersMap = normalizeChannelMessageFiltersMap;
exports.filterKeysForManagementAction = filterKeysForManagementAction;
exports.filterKeysForOppositeSignalClose = filterKeysForOppositeSignalClose;
exports.filterKeysForPendingCancel = filterKeysForPendingCancel;
exports.isCategoryIgnored = isCategoryIgnored;
exports.isChannelManagementBlocked = isChannelManagementBlocked;
exports.managementFilterContextFromParsed = managementFilterContextFromParsed;
exports.isChannelSlTpUpdateBlocked = isChannelSlTpUpdateBlocked;
exports.isOppositeSignalCloseBlocked = isOppositeSignalCloseBlocked;
exports.isPendingCancelBlocked = isPendingCancelBlocked;
const ALL_KEYS = [
    'close_full',
    'close_half',
    'break_even',
    'modify_sl',
    'modify_tp',
    'close_tp_levels',
    'close_all',
    'close_worse_entries',
    'delete_pendings',
    'reverse',
];
exports.DEFAULT_CHANNEL_FILTERS = Object.fromEntries(ALL_KEYS.map(k => [k, 'allow']));
function normalizeChannelFilters(raw) {
    const base = { ...exports.DEFAULT_CHANNEL_FILTERS };
    if (!raw || typeof raw !== 'object')
        return base;
    const o = raw;
    for (const key of ALL_KEYS) {
        const v = o[key];
        if (v === 'ignore' || v === 'allow')
            base[key] = v;
    }
    return base;
}
function normalizeChannelMessageFiltersMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const out = {};
    for (const [channelId, filters] of Object.entries(raw)) {
        if (!channelId.trim())
            continue;
        out[channelId] = normalizeChannelFilters(filters);
    }
    return out;
}
/** Parsed management `action` → filter categories that must all be allowed. */
function filterKeysForManagementAction(action, ctx = {}) {
    const a = String(action ?? '').toLowerCase();
    switch (a) {
        case 'close':
            // Ignoring "Close full position" blocks every full-close variant from the channel.
            return ['close_full', 'close_all'];
        case 'close_worse_entries':
            return ['close_worse_entries'];
        case 'partial_profit':
            return ['close_half', 'close_tp_levels'];
        case 'partial_breakeven':
            return ['close_half', 'break_even'];
        case 'breakeven':
            return ['break_even'];
        case 'modify': {
            const keys = [];
            if (ctx.hasNewSl)
                keys.push('modify_sl');
            if (ctx.hasNewTp)
                keys.push('modify_tp');
            if (keys.length === 0)
                keys.push('modify_sl', 'modify_tp');
            return keys;
        }
        default:
            return [];
    }
}
/** Categories used when closing opposite-direction legs on a new entry signal. */
function filterKeysForOppositeSignalClose() {
    return ['close_full', 'close_all'];
}
/** Pending cancellation tied to a full close from the channel. */
function filterKeysForPendingCancel() {
    return ['delete_pendings', 'close_full', 'close_all'];
}
function isCategoryIgnored(filters, channelId, key) {
    if (!channelId)
        return false;
    const ch = filters?.[channelId];
    if (!ch)
        return false;
    return (ch[key] ?? 'allow') === 'ignore';
}
/**
 * True when ANY relevant category for this action is set to ignore for the channel.
 */
function isChannelManagementBlocked(filters, channelId, action, ctx = {}) {
    const keys = filterKeysForManagementAction(action, ctx);
    if (!keys.length)
        return false;
    return keys.some(k => isCategoryIgnored(filters, channelId, k));
}
function managementFilterContextFromParsed(parsed) {
    const hasNewSl = typeof parsed.sl === 'number' && Number.isFinite(parsed.sl) && parsed.sl > 0;
    const hasNewTp = (parsed.tp ?? []).some((t) => typeof t === 'number' && Number.isFinite(t) && t > 0);
    return { hasNewSl, hasNewTp };
}
/** SL/TP basket refresh and modify instructions share the same per-channel filters. */
function isChannelSlTpUpdateBlocked(filters, channelId, parsed) {
    return isChannelManagementBlocked(filters, channelId, 'modify', managementFilterContextFromParsed(parsed));
}
function isOppositeSignalCloseBlocked(filters, channelId) {
    return filterKeysForOppositeSignalClose().some(k => isCategoryIgnored(filters, channelId, k));
}
function isPendingCancelBlocked(filters, channelId) {
    return filterKeysForPendingCancel().some(k => isCategoryIgnored(filters, channelId, k));
}
