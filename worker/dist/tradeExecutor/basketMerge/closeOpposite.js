"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeOppositeDirectionTrades = closeOppositeDirectionTrades;
const metatraderapi_1 = require("../../metatraderapi");
const channelMessageFilters_1 = require("../../channelMessageFilters");
const pendingCancel_1 = require("./pendingCancel");
async function closeOppositeDirectionTrades(ctx, signal, parsed, broker, symbol) {
    if (!(0, metatraderapi_1.hasMetatraderApiConfigured)())
        return;
    const manual = (broker.manual_settings ?? {});
    if (manual.close_on_opposite_signal !== true)
        return;
    if ((0, channelMessageFilters_1.isOppositeSignalCloseBlocked)((0, channelMessageFilters_1.normalizeChannelMessageFiltersMap)(broker.channel_message_filters), signal.channel_id))
        return;
    const a = String(parsed.action ?? '').toLowerCase();
    if (a !== 'buy' && a !== 'sell')
        return;
    const channelBuy = a === 'buy';
    const oppDir = channelBuy ? 'sell' : 'buy';
    const uuid = broker.metaapi_account_id;
    const api = ctx.apiFor(broker);
    if (!api)
        return;
    const { data: opposites } = await ctx.supabase
        .from('trades')
        .select('id,signal_id,broker_account_id,metaapi_order_id,symbol,direction,lot_size')
        .eq('broker_account_id', broker.id)
        .eq('symbol', symbol)
        .eq('status', 'open')
        .eq('direction', oppDir);
    const rows = opposites ?? [];
    if (!rows.length)
        return;
    const scopes = [];
    for (const t of rows) {
        const ticket = Number(t.metaapi_order_id);
        if (!Number.isFinite(ticket) || ticket <= 0)
            continue;
        try {
            await api.orderClose(uuid, { ticket });
            await ctx.supabase
                .from('trades')
                .update({ status: 'closed', closed_at: new Date().toISOString() })
                .eq('id', t.id);
            scopes.push({ signalId: t.signal_id, brokerAccountId: broker.id, symbol });
            try {
                await ctx.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'opposite_signal_close',
                    status: 'success',
                    request_payload: {
                        closed_trade_id: t.id,
                        ticket,
                        direction: t.direction,
                        channel_action: a,
                        symbol,
                    },
                });
            }
            catch {
                // logging best-effort
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[tradeExecutor] opposite_signal_close failed trade=${t.id} ticket=${ticket} broker=${broker.id}: ${msg}`);
            try {
                await ctx.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'opposite_signal_close',
                    status: 'failed',
                    request_payload: { closed_trade_id: t.id, ticket, symbol },
                    error_message: msg,
                });
            }
            catch {
                // best-effort
            }
        }
    }
    if (scopes.length && !(0, channelMessageFilters_1.isPendingCancelBlocked)((0, channelMessageFilters_1.normalizeChannelMessageFiltersMap)(broker.channel_message_filters), signal.channel_id)) {
        await (0, pendingCancel_1.cancelRangePendingLegsForScopes)(ctx, signal.user_id, signal.id, scopes, 'opposite_signal_close');
    }
}
