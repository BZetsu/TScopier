"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeBrokerConnectionStatus = writeBrokerConnectionStatus;
exports.clearBrokerConnectionStatusCache = clearBrokerConnectionStatusCache;
const brokerConnectError_1 = require("./brokerConnectError");
const MIN_WRITE_INTERVAL_MS = Math.max(30000, Number(process.env.BROKER_CONNECTION_STATUS_MIN_WRITE_MS ?? 60000));
const lastWritten = new Map();
/**
 * Debounced broker connection_status writer — worker is the sole DB writer.
 * Skips no-op updates and enforces a minimum interval per broker id.
 */
async function writeBrokerConnectionStatus(supabase, brokerId, status, opts) {
    const now = Date.now();
    const prev = lastWritten.get(brokerId);
    if (!opts?.force
        && prev?.status === status
        && now - prev.at < MIN_WRITE_INTERVAL_MS
        && !opts?.rawError) {
        return;
    }
    const patch = { connection_status: status };
    // Keep fxsocket_status aligned so UI badges / Reconnect visibility match worker downs.
    if (status === 'connected') {
        patch.fxsocket_status = 'connected';
        patch.connection_error_kind = null;
        patch.connection_error_message = null;
        patch.connection_error = null;
    }
    else if (status === 'recovering') {
        patch.fxsocket_status = 'connecting';
        patch.connection_error_kind = null;
        patch.connection_error_message = null;
        patch.connection_error = null;
    }
    else if (status === 'error') {
        patch.fxsocket_status = 'error';
        if (opts?.rawError) {
            const raw = String(opts.rawError).trim() || 'Broker session is not connected';
            patch.connection_error_kind = opts.errorKind ?? (0, brokerConnectError_1.classifyBrokerConnectError)(raw);
            patch.connection_error_message = raw;
            patch.connection_error = raw;
        }
        else {
            patch.connection_error_kind = 'session_expired';
            patch.connection_error_message = 'session expired';
            patch.connection_error = 'session expired';
        }
    }
    else if (opts?.rawError) {
        const raw = String(opts.rawError).trim() || 'Broker session is not connected';
        patch.connection_error_kind = opts.errorKind ?? (0, brokerConnectError_1.classifyBrokerConnectError)(raw);
        patch.connection_error_message = raw;
        patch.connection_error = raw;
    }
    const { error } = await supabase
        .from('broker_accounts')
        .update(patch)
        .eq('id', brokerId);
    if (error) {
        console.warn(`[brokerConnectionStatus] update failed broker=${brokerId}:`, error.message);
        return;
    }
    lastWritten.set(brokerId, { status, at: now });
}
function clearBrokerConnectionStatusCache(brokerId) {
    if (brokerId)
        lastWritten.delete(brokerId);
    else
        lastWritten.clear();
}
