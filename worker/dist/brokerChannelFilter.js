"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSignalChannelIds = normalizeSignalChannelIds;
exports.channelMatchesBrokerSignal = channelMatchesBrokerSignal;
function normalizeSignalChannelIds(raw) {
    if (!(raw === null || raw === void 0 ? void 0 : raw.length))
        return [];
    return raw.map(String).filter(Boolean);
}
/**
 * True when this broker should copy signals from `channelId`.
 * Whitelist applies when enforcement is on or when channel ids were persisted
 * (Configure Trading modal checkboxes).
 */
function channelMatchesBrokerSignal(broker, channelId) {
    var ids = normalizeSignalChannelIds(broker.signal_channel_ids);
    var enforce = broker.enforce_signal_channel_filter === true;
    var useWhitelist = enforce || ids.length > 0;
    if (!useWhitelist)
        return true;
    if (!channelId)
        return false;
    if (ids.length === 0)
        return false;
    return ids.includes(channelId);
}
