"use strict";
/**
 * Re-dispatch failed/skipped entry signals from Copier Logs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRYABLE_SIGNAL_SKIP_REASONS = exports.AI_REVIEW_PRICE_PASSED_REASON = exports.AI_REVIEW_EXPIRED_REASON = exports.AI_REVIEW_MAX_AGE_MS = exports.SIGNAL_RETRY_DISPATCH_SOURCE = void 0;
exports.retrySignal = retrySignal;
const signalEntryZoneSanity_1 = require("./signalEntryZoneSanity");
const signalRevision_1 = require("./signalRevision");
const tradeSignalActions_1 = require("./tradeSignalActions");
const manualPlanner_1 = require("./manualPlanner");
const helpers_1 = require("./tradeExecutor/helpers");
const brokerChannelFilter_1 = require("./brokerChannelFilter");
exports.SIGNAL_RETRY_DISPATCH_SOURCE = 'signal_retry';
exports.AI_REVIEW_MAX_AGE_MS = 2 * 60000;
exports.AI_REVIEW_EXPIRED_REASON = 'ai_review_expired';
exports.AI_REVIEW_PRICE_PASSED_REASON = 'ai_review_price_passed';
exports.RETRYABLE_SIGNAL_SKIP_REASONS = new Set([
    manualPlanner_1.SKIP_REASON_ENTRY_NOT_OPENED,
    signalEntryZoneSanity_1.ENTRY_ZONE_FAR_FROM_MARKET_REASON,
    'broker_session_not_connected',
    'entry_zone_far_from_market',
    'ai classified as uncertain; human review required',
]);
function reviewAgeAllowed(createdAt, now = Date.now()) {
    const createdMs = Date.parse(createdAt);
    return Number.isFinite(createdMs) && now - createdMs >= 0 && now - createdMs <= exports.AI_REVIEW_MAX_AGE_MS;
}
async function reviewPriceAllowed(executor, signal) {
    const parsed = signal.parsed_data;
    const action = String(parsed?.action ?? '').toLowerCase();
    const symbol = String(parsed?.symbol ?? '').trim();
    const entry = Number(parsed?.entry_price);
    const zoneLow = Number(parsed?.entry_zone_low);
    const zoneHigh = Number(parsed?.entry_zone_high);
    if (!symbol || (action !== 'buy' && action !== 'sell'))
        return false;
    const hasZone = Number.isFinite(zoneLow) && Number.isFinite(zoneHigh) && zoneLow > 0 && zoneHigh > 0;
    if (!hasZone && (!Number.isFinite(entry) || entry <= 0))
        return false;
    const brokers = (executor.brokersByUser.get(signal.user_id) ?? []).filter(b => b.is_active && (0, helpers_1.brokerHasLinkedSession)(b) && (0, brokerChannelFilter_1.channelMatchesBrokerSignal)(b, signal.channel_id));
    if (brokers.length === 0)
        return false;
    for (const broker of brokers) {
        const uuid = (0, helpers_1.brokerSessionUuid)(broker);
        const api = uuid ? executor.apiFor(broker) : null;
        if (!uuid || !api)
            return false;
        const brokerSymbol = (0, helpers_1.applySymbolMapping)(symbol, broker).symbol;
        const params = await executor.getSymbolParams(uuid, brokerSymbol).catch(() => null);
        const point = Number(params?.point ?? 0);
        const tolerancePips = Math.max(0, Number((broker.manual_settings ?? {}).signal_entry_pip_tolerance ?? 10));
        if (!Number.isFinite(point) || point <= 0)
            return false;
        const tolerance = tolerancePips * point;
        const quote = await api.quote(uuid, brokerSymbol).catch(() => null);
        if (!quote || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask))
            return false;
        const ref = action === 'buy' ? quote.ask : quote.bid;
        const within = hasZone
            ? ref >= Math.min(zoneLow, zoneHigh) - tolerance && ref <= Math.max(zoneLow, zoneHigh) + tolerance
            : Math.abs(ref - entry) <= tolerance;
        if (!within)
            return false;
    }
    return true;
}
async function expireReviewSignal(supabase, signal, reason) {
    await supabase.from('signals').update({ status: 'skipped', skip_reason: reason })
        .eq('id', signal.id).eq('user_id', signal.user_id).eq('status', 'skipped');
}
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
    if (String(existing.skip_reason ?? '').trim().toLowerCase() === 'ai classified as uncertain; human review required') {
        if (!reviewAgeAllowed(existing.created_at)) {
            await expireReviewSignal(supabase, existing, exports.AI_REVIEW_EXPIRED_REASON);
            return { ok: false, reason: exports.AI_REVIEW_EXPIRED_REASON };
        }
        if (!(await reviewPriceAllowed(executor, existing))) {
            await expireReviewSignal(supabase, existing, exports.AI_REVIEW_PRICE_PASSED_REASON);
            return { ok: false, reason: exports.AI_REVIEW_PRICE_PASSED_REASON };
        }
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
