"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNativePendingCapability = resolveNativePendingCapability;
function hasMethod(api, name) {
    return typeof api?.[name] === 'function';
}
function resolveNativePendingCapability(input) {
    const broker = input.broker;
    const platformRaw = String(broker?.platform ?? '').trim().toUpperCase();
    const platform = platformRaw === 'MT4' ? 'mt4' : platformRaw === 'MT5' ? 'mt5' : 'unknown';
    const linked = Boolean(String(broker?.fxsocket_account_id ?? broker?.metaapi_account_id ?? '').trim());
    const connected = broker?.connection_status === 'connected' || broker?.terminal_connected === true;
    const tradeAllowed = broker?.trade_allowed !== false;
    const provider = linked ? 'fxsocket' : 'unknown';
    const api = input.api;
    const canPlace = hasMethod(api, 'orderSend') && hasMethod(api, 'quote');
    const canReconcile = hasMethod(api, 'openedOrders');
    const canCancel = hasMethod(api, 'orderClose');
    if (provider !== 'fxsocket') {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'provider_unsupported' };
    }
    if (platform !== 'mt4' && platform !== 'mt5') {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'platform_unsupported' };
    }
    if (!connected || !tradeAllowed) {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'connection_not_ready' };
    }
    if (!canPlace) {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'native_methods_unavailable' };
    }
    if (!canReconcile) {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'reconciliation_unavailable' };
    }
    if (!canCancel) {
        return { supported: false, provider, platform, canPlace, canReconcile, canCancel, reason: 'cancellation_unavailable' };
    }
    return { supported: true, provider, platform, canPlace, canReconcile, canCancel, reason: 'supported' };
}
