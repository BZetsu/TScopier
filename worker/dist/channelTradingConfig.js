"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeChannelTradingConfigsMap = normalizeChannelTradingConfigsMap;
exports.buildDefaultChannelTradingConfig = buildDefaultChannelTradingConfig;
exports.channelManualSettingsComplete = channelManualSettingsComplete;
exports.storedPerChannelConfigComplete = storedPerChannelConfigComplete;
exports.channelConfigReadyForExecution = channelConfigReadyForExecution;
exports.resolveChannelTradingConfig = resolveChannelTradingConfig;
exports.withChannelTradingConfig = withChannelTradingConfig;
exports.cloneChannelTradingConfig = cloneChannelTradingConfig;
exports.removeChannelTradingConfigKey = removeChannelTradingConfigKey;
const normalizeManualSettings_1 = require("./manualPlanning/normalizeManualSettings");
const brokerChannelFilter_1 = require("./brokerChannelFilter");
function normalizeChannelTradingConfigsMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const out = {};
    for (const [channelId, value] of Object.entries(raw)) {
        if (!channelId.trim() || !value || typeof value !== 'object' || Array.isArray(value))
            continue;
        const row = value;
        const mode = row.copier_mode;
        out[channelId] = {
            copier_mode: mode === 'ai' || mode === 'manual' ? mode : undefined,
            manual_settings: row.manual_settings && typeof row.manual_settings === 'object'
                ? row.manual_settings
                : undefined,
            ai_settings: row.ai_settings && typeof row.ai_settings === 'object'
                ? row.ai_settings
                : undefined,
        };
    }
    return out;
}
function buildDefaultChannelTradingConfig() {
    return {
        copier_mode: 'manual',
        manual_settings: (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)({
            fixed_lot: 0.01,
            trade_style: 'single',
            risk_mode: 'fixed_lot',
        }),
        ai_settings: {},
    };
}
/** Per-channel manual_settings must include fixed_lot and trade_style before execution. */
function channelManualSettingsComplete(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return false;
    const normalized = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(raw);
    const lot = Number(normalized.fixed_lot);
    const style = normalized.trade_style;
    return Number.isFinite(lot) && lot > 0 && (style === 'single' || style === 'multi');
}
function storedPerChannelConfigComplete(configs, channelId) {
    const entry = configs[channelId];
    if (!entry)
        return false;
    return channelManualSettingsComplete(entry.manual_settings);
}
function channelConfigReadyForExecution(broker, channelId) {
    if (!channelId) {
        return { ready: true, source: 'unlinked' };
    }
    const linked = (0, brokerChannelFilter_1.normalizeSignalChannelIds)(broker.signal_channel_ids);
    if (!linked.includes(channelId)) {
        return { ready: true, source: 'unlinked' };
    }
    const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs);
    const entry = configs[channelId];
    if (!entry) {
        return { ready: false, reason: 'channel_config_missing', channelId };
    }
    if (!channelManualSettingsComplete(entry.manual_settings)) {
        return { ready: false, reason: 'channel_config_incomplete', channelId };
    }
    return { ready: true, source: 'per_channel' };
}
function resolveChannelTradingConfig(broker, channelId) {
    const fallbackMode = (broker.copier_mode ?? 'manual');
    const fallbackManual = (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(broker.manual_settings);
    const fallbackAi = (broker.ai_settings ?? {});
    if (!channelId) {
        return {
            copier_mode: fallbackMode,
            manual_settings: fallbackManual,
            ai_settings: fallbackAi,
            config_source: 'unlinked',
        };
    }
    const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs);
    const channelConfig = configs[channelId];
    const ready = channelConfigReadyForExecution(broker, channelId);
    if (ready.ready && ready.source === 'per_channel' && channelConfig) {
        return {
            copier_mode: channelConfig.copier_mode ?? fallbackMode,
            manual_settings: (0, normalizeManualSettings_1.normalizeManualSettingsForExecution)(channelConfig.manual_settings),
            ai_settings: (channelConfig.ai_settings ?? fallbackAi),
            config_source: 'per_channel',
        };
    }
    if (ready.ready && ready.source === 'unlinked') {
        return {
            copier_mode: fallbackMode,
            manual_settings: fallbackManual,
            ai_settings: fallbackAi,
            config_source: 'broker_fallback',
        };
    }
    // Linked channel without complete per-channel config — caller must skip execution.
    return {
        copier_mode: fallbackMode,
        manual_settings: fallbackManual,
        ai_settings: fallbackAi,
        config_source: 'broker_fallback',
    };
}
function withChannelTradingConfig(broker, channelId) {
    const resolved = resolveChannelTradingConfig(broker, channelId);
    return {
        ...broker,
        copier_mode: resolved.copier_mode,
        manual_settings: resolved.manual_settings,
        ai_settings: resolved.ai_settings,
    };
}
function cloneChannelTradingConfig(from) {
    return {
        copier_mode: from.copier_mode ?? 'manual',
        manual_settings: from.manual_settings
            ? JSON.parse(JSON.stringify(from.manual_settings))
            : buildDefaultChannelTradingConfig().manual_settings,
        ai_settings: from.ai_settings
            ? JSON.parse(JSON.stringify(from.ai_settings))
            : {},
    };
}
function removeChannelTradingConfigKey(configs, channelId) {
    const next = { ...configs };
    delete next[channelId];
    return next;
}
