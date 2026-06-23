"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeBrokerTerminalHealth = writeBrokerTerminalHealth;
exports.writeBrokerTerminalUnhealthy = writeBrokerTerminalUnhealthy;
exports.clearBrokerTerminalHealthCache = clearBrokerTerminalHealthCache;
const fxsocketMtStatus_1 = require("./fxsocketMtStatus");
const MIN_WRITE_INTERVAL_MS = Math.max(30000, Number(process.env.BROKER_TERMINAL_HEALTH_MIN_WRITE_MS ?? 60000));
const lastWritten = new Map();
function snapshotFromStatus(status) {
    return (0, fxsocketMtStatus_1.terminalHealthRowPatchFromMtStatus)(status);
}
function snapshotsEqual(a, b) {
    return a.terminal_connected === b.terminal_connected && a.trade_allowed === b.trade_allowed;
}
/**
 * Debounced writer for terminal_connected / trade_allowed from GET /Status.
 */
async function writeBrokerTerminalHealth(supabase, brokerId, status, opts) {
    const snapshot = snapshotFromStatus(status);
    const now = Date.now();
    const prev = lastWritten.get(brokerId);
    if (!opts?.force
        && prev
        && snapshotsEqual(prev.snapshot, snapshot)
        && now - prev.at < MIN_WRITE_INTERVAL_MS) {
        return;
    }
    const { error } = await supabase
        .from('broker_accounts')
        .update({
        terminal_connected: snapshot.terminal_connected,
        trade_allowed: snapshot.trade_allowed,
    })
        .eq('id', brokerId);
    if (error) {
        console.warn(`[brokerTerminalHealth] update failed broker=${brokerId}:`, error.message);
        return;
    }
    lastWritten.set(brokerId, { snapshot, at: now });
}
async function writeBrokerTerminalUnhealthy(supabase, brokerId, opts) {
    await writeBrokerTerminalHealth(supabase, brokerId, {
        status: 'error',
        terminal: { alive: false },
        broker: { connected: false },
        account: { tradeAllowed: false, loggedIn: false },
        bridge: { tradeEaReady: false, symbolsSynced: false },
    }, opts);
}
function clearBrokerTerminalHealthCache(brokerId) {
    if (brokerId)
        lastWritten.delete(brokerId);
    else
        lastWritten.clear();
}
