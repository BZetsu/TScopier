"use strict";
/**
 * Re-dispatch failed/skipped entry signals from Copier Logs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRYABLE_SIGNAL_SKIP_REASONS = exports.SIGNAL_RETRY_DISPATCH_SOURCE = void 0;
exports.retrySignal = retrySignal;
const signalEntryZoneSanity_1 = require("./signalEntryZoneSanity");
const signalRevision_1 = require("./signalRevision");
const tradeSignalActions_1 = require("./tradeSignalActions");
const manualPlanner_1 = require("./manualPlanner");
exports.SIGNAL_RETRY_DISPATCH_SOURCE = 'signal_retry';
exports.RETRYABLE_SIGNAL_SKIP_REASONS = new Set([
    manualPlanner_1.SKIP_REASON_ENTRY_NOT_OPENED,
    signalEntryZoneSanity_1.ENTRY_ZONE_FAR_FROM_MARKET_REASON,
    'broker_session_not_connected',
    'entry_zone_far_from_market',
]);
async function resetSignalForRetry(supabase, args) {
    const { data, error } = await supabase
        .from('signals')
        .update({ status: 'parsed', skip_reason: null })
        .eq('id', args.signalId)
        .eq('user_id', args.userId)
        .in('status', ['executed', 'skipped', 'failed', 'pending'])
        .select('id');
    if (error) {
        console.warn(`[retrySignal] signal reset failed id=${args.signalId}: ${error.message}`);
        return false;
    }
    return (data?.length ?? 0) > 0;
}
function toDispatchRow(signal) {
    return {
        id: signal.id,
        user_id: signal.user_id,
        channel_id: signal.channel_id,
        parsed_data: signal.parsed_data,
        status: 'parsed',
        parent_signal_id: signal.parent_signal_id,
        is_modification: signal.is_modification,
        telegram_message_id: signal.telegram_message_id,
        reply_to_message_id: signal.reply_to_message_id,
        created_at: signal.created_at,
        user_override: signal.user_override,
    };
}
function isRetryableSignal(signal) {
    const action = String(signal.parsed_data?.action ?? '').toLowerCase();
    if (!(0, tradeSignalActions_1.isEntryAction)(action))
        return false;
    const status = String(signal.status).toLowerCase();
    if (status === 'failed')
        return true;
    if (status !== 'skipped')
        return false;
    const reason = String(signal.skip_reason ?? '').trim().toLowerCase();
    if (!reason)
        return false;
    return exports.RETRYABLE_SIGNAL_SKIP_REASONS.has(reason);
}
async function retrySignal(executor, args) {
    const supabase = executor.supabase;
    const existing = await (0, signalRevision_1.loadSignalById)(supabase, args.signalId);
    if (!existing || existing.user_id !== args.userId) {
        return { ok: false, reason: 'signal_not_found' };
    }
    if (!isRetryableSignal(existing)) {
        return { ok: false, reason: 'signal_not_retryable' };
    }
    if (existing.status !== 'parsed') {
        const reset = await resetSignalForRetry(supabase, { userId: args.userId, signalId: args.signalId });
        if (!reset) {
            return { ok: false, reason: 'signal_not_retryable' };
        }
    }
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: args.userId,
            signal_id: args.signalId,
            action: 'signal_retry',
            status: 'success',
            request_payload: { source: exports.SIGNAL_RETRY_DISPATCH_SOURCE },
        });
    }
    catch { /* best-effort */ }
    const fresh = await (0, signalRevision_1.loadSignalById)(supabase, args.signalId);
    if (!fresh?.parsed_data?.action) {
        return { ok: false, reason: 'signal_not_found' };
    }
    const accepted = await executor.acceptDispatchSignalAwait(toDispatchRow(fresh), {
        source: exports.SIGNAL_RETRY_DISPATCH_SOURCE,
        priority: 'high',
    });
    if (!accepted) {
        return { ok: false, accepted: false, reason: 'dispatch_not_accepted' };
    }
    return { ok: true, accepted: true };
}
