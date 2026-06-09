"use strict";
/**
 * Broker-side fallback when DB has no open trades for a channel close instruction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractOpenOrderFromBrokerRaw = extractOpenOrderFromBrokerRaw;
exports.filterTscopierOrdersForChannelClose = filterTscopierOrdersForChannelClose;
exports.tryBrokerFallbackClose = tryBrokerFallbackClose;
const basketModFollowUp_1 = require("./basketModFollowUp");
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
const tscopierComment_1 = require("./tscopierComment");
const tradeComment_1 = require("./tradeComment");
function extractOpenOrderFromBrokerRaw(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    const ticket = Number(o.ticket ?? o.Ticket ?? o.orderId ?? o.OrderID ?? 0);
    if (!Number.isFinite(ticket) || ticket <= 0)
        return null;
    const symbol = String(o.symbol ?? o.Symbol ?? '').trim();
    if (!symbol)
        return null;
    const comment = String(o.comment ?? o.Comment ?? '').trim();
    const lots = Number(o.lots ?? o.Lots ?? o.volume ?? o.Volume ?? 0);
    const op = String(o.operation ?? o.Operation ?? o.type ?? o.Type ?? '').toLowerCase();
    const isBuy = op.includes('buy') || op === '0' || op === 'buy';
    return { ticket, symbol, comment, lots: Number.isFinite(lots) ? lots : 0, isBuy };
}
function filterTscopierOrdersForChannelClose(args) {
    const { orders, channelSlug, symbolFilter, channelSignalIdPrefixes } = args;
    return orders.filter(o => {
        if (!o.comment.startsWith('TSCopier:'))
            return false;
        const parsed = (0, tscopierComment_1.parseTscopierComment)(o.comment);
        if (!parsed)
            return false;
        if (!(0, tscopierComment_1.tscopierCommentMatchesChannelSlug)(o.comment, channelSlug))
            return false;
        if (channelSignalIdPrefixes?.size) {
            const prefix = parsed.signalIdPrefix.toLowerCase();
            if (!channelSignalIdPrefixes.has(prefix))
                return false;
        }
        if (symbolFilter?.trim()) {
            if (!(0, basketModFollowUp_1.symbolsCompatibleForBasket)(symbolFilter, o.symbol))
                return false;
        }
        return true;
    });
}
async function tryBrokerFallbackClose(args) {
    const { supabase, api, signal, parsed, brokers, channelDisplayName, channelUsername, closeWithVerification, } = args;
    const symbolFilter = parsed.symbol != null && String(parsed.symbol).trim()
        ? String(parsed.symbol).trim()
        : null;
    const channelSlug = (0, tradeComment_1.sanitizeChannelCommentSlug)(channelDisplayName?.trim() || channelUsername?.trim().replace(/^@/, '') || '') || null;
    let channelSignalIdPrefixes;
    if (signal.channel_id) {
        const { data: sigRows } = await supabase
            .from('signals')
            .select('id')
            .eq('user_id', signal.user_id)
            .eq('channel_id', signal.channel_id)
            .order('created_at', { ascending: false })
            .limit(500);
        if (sigRows?.length) {
            channelSignalIdPrefixes = new Set(sigRows.map((r) => String(r.id).slice(0, 8).toLowerCase()));
        }
    }
    let closed = 0;
    let failed = 0;
    await Promise.allSettled(brokers.map(async (broker) => {
        const uuid = broker.metaapi_account_id;
        if (!uuid || uuid.includes('|'))
            return;
        let rawOrders = [];
        try {
            rawOrders = await api.openedOrders(uuid) ?? [];
        }
        catch {
            return;
        }
        const parsedOrders = rawOrders
            .map(extractOpenOrderFromBrokerRaw)
            .filter((o) => o != null);
        const targets = filterTscopierOrdersForChannelClose({
            orders: parsedOrders,
            channelSlug,
            symbolFilter,
            channelSignalIdPrefixes,
        });
        for (const order of targets) {
            try {
                const result = await closeWithVerification(api, uuid, order.ticket);
                if (!result.confirmed) {
                    failed += 1;
                    continue;
                }
                closed += 1;
                await supabase
                    .from('trades')
                    .update({ status: 'closed', closed_at: new Date().toISOString() })
                    .eq('user_id', signal.user_id)
                    .eq('broker_account_id', broker.id)
                    .eq('metaapi_order_id', String(order.ticket))
                    .in('status', ['open', 'pending']);
                if (signal.channel_id) {
                    await (0, channelActiveTradeParams_1.clearChannelActiveTradeParamsWhenFlat)(supabase, {
                        userId: signal.user_id,
                        channelId: signal.channel_id,
                        symbolHint: order.symbol,
                    });
                }
                await supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'mgmt_close',
                    status: 'success',
                    request_payload: {
                        ticket: order.ticket,
                        action: 'close',
                        broker_fallback: true,
                        symbol: order.symbol,
                    },
                });
            }
            catch {
                failed += 1;
            }
        }
    }));
    return { closed, failed };
}
