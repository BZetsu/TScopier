"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGNAL_RANGE_WAKE_DISPATCH_SOURCE = void 0;
exports.waitRowToPlannerWait = waitRowToPlannerWait;
exports.upsertSignalRangeEntryWait = upsertSignalRangeEntryWait;
exports.markSignalRangeEntryFired = markSignalRangeEntryFired;
exports.hasActiveSignalRangeEntryWait = hasActiveSignalRangeEntryWait;
exports.cancelSignalRangeEntryWaitsForSignal = cancelSignalRangeEntryWaitsForSignal;
exports.logSignalRangeEntryNoPrice = logSignalRangeEntryNoPrice;
exports.logSignalRangeEntryWaiting = logSignalRangeEntryWaiting;
exports.logSignalRangeEntryFired = logSignalRangeEntryFired;
exports.SIGNAL_RANGE_WAKE_DISPATCH_SOURCE = 'signal_range_wake';
const manualPlanner_1 = require("./manualPlanner");
function waitRowToPlannerWait(row) {
    return {
        isBuy: row.is_buy,
        entryPrice: row.entry_price,
        zoneLo: row.zone_lo,
        zoneHi: row.zone_hi,
        tolerancePips: row.tolerance_pips,
    };
}
async function upsertSignalRangeEntryWait(supabase, args) {
    const hours = (0, manualPlanner_1.clampPendingExpiryHours)(args.manual.pending_expiry_hours);
    const expiresAt = hours > 0
        ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
        : null;
    const row = {
        signal_id: args.signal.id,
        user_id: args.signal.user_id,
        broker_account_id: args.broker.id,
        metaapi_account_id: args.uuid,
        symbol: args.symbol,
        is_buy: args.wait.isBuy,
        entry_price: args.wait.entryPrice,
        zone_lo: args.wait.zoneLo,
        zone_hi: args.wait.zoneHi,
        tolerance_pips: args.wait.tolerancePips,
        status: 'waiting',
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
        .from('signal_range_entry_waits')
        .upsert(row, { onConflict: 'signal_id,broker_account_id' });
    if (error) {
        console.warn(`[signalRangeEntry] upsert wait failed signal=${args.signal.id} broker=${args.broker.id}: ${error.message}`);
    }
}
async function markSignalRangeEntryFired(supabase, signalId, brokerAccountId) {
    await supabase
        .from('signal_range_entry_waits')
        .update({ status: 'fired', updated_at: new Date().toISOString() })
        .eq('signal_id', signalId)
        .eq('broker_account_id', brokerAccountId)
        .eq('status', 'waiting');
}
async function hasActiveSignalRangeEntryWait(supabase, signalId) {
    const { count, error } = await supabase
        .from('signal_range_entry_waits')
        .select('id', { count: 'exact', head: true })
        .eq('signal_id', signalId)
        .eq('status', 'waiting');
    if (error) {
        console.warn(`[signalRangeEntry] hasActiveWait failed signal=${signalId}: ${error.message}`);
        return false;
    }
    return (count ?? 0) > 0;
}
async function cancelSignalRangeEntryWaitsForSignal(supabase, signalId, brokerAccountId, reason = 'basket_opened') {
    let q = supabase
        .from('signal_range_entry_waits')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('signal_id', signalId)
        .eq('status', 'waiting');
    if (brokerAccountId)
        q = q.eq('broker_account_id', brokerAccountId);
    const { error } = await q;
    if (error) {
        console.warn(`[signalRangeEntry] cancel waits failed signal=${signalId} reason=${reason}: ${error.message}`);
    }
}
async function logSignalRangeEntryNoPrice(supabase, signal, broker, parsed, symbol) {
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: broker.id,
            action: 'signal_range_entry_no_price',
            status: 'skipped',
            request_payload: {
                direction: String(parsed.action ?? '').toLowerCase(),
                symbol,
            },
        });
    }
    catch {
        /* best-effort */
    }
}
async function logSignalRangeEntryWaiting(supabase, signal, broker, wait, symbol, bid, ask) {
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: broker.id,
            action: 'signal_range_entry_waiting',
            status: 'success',
            request_payload: {
                direction: wait.isBuy ? 'buy' : 'sell',
                symbol,
                entry_price: wait.entryPrice,
                zone_lo: wait.zoneLo,
                zone_hi: wait.zoneHi,
                tolerance_pips: wait.tolerancePips,
                bid,
                ask,
            },
        });
    }
    catch {
        /* best-effort */
    }
}
async function logSignalRangeEntryFired(supabase, signal, brokerAccountId, wait, symbol) {
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: brokerAccountId,
            action: 'signal_range_entry_fired',
            status: 'success',
            request_payload: {
                direction: wait.isBuy ? 'buy' : 'sell',
                symbol,
                entry_price: wait.entryPrice,
                zone_lo: wait.zoneLo,
                zone_hi: wait.zoneHi,
                tolerance_pips: wait.tolerancePips,
            },
        });
    }
    catch {
        /* best-effort */
    }
}
