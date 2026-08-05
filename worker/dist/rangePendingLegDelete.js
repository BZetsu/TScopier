"use strict";
/**
 * Delete active `range_pending_legs` when a signal basket is flat or layering
 * must stop (Layer-till-close OFF after a TP hit).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteRangePendingLegsForBasket = deleteRangePendingLegsForBasket;
exports.purgeRangePendingLegsIfBasketFlat = purgeRangePendingLegsIfBasketFlat;
exports.purgeRangePendingLegsForBaskets = purgeRangePendingLegsForBaskets;
const rangePendingFireGuard_1 = require("./rangePendingFireGuard");
const fxsocketClient_1 = require("./fxsocketClient");
const mtApiByAccount_1 = require("./mtApiByAccount");
const rangeBrokerPendingHelpers_1 = require("./rangeBrokerPendingHelpers");
const signalEntryPendingHelpers_1 = require("./signalEntryPendingHelpers");
function readComment(row) {
    if (row == null || typeof row !== 'object')
        return '';
    const o = row;
    const c = o.comment ?? o.Comment;
    return typeof c === 'string' ? c : '';
}
/**
 * Cancel resting BuyLimit/SellLimit tickets for this basket, then remove DB rows.
 * Used when Layer-till-close is OFF and a TP is hit (or basket goes flat).
 */
async function cancelBrokerPendingLegsForScope(supabase, scope, reason) {
    if (!(0, fxsocketClient_1.hasFxsocketConfigured)())
        return 0;
    const { data, error } = await supabase
        .from('range_pending_legs')
        .select('id,signal_id,user_id,broker_account_id,metaapi_account_id,ticket,comment,symbol')
        .eq('signal_id', scope.signalId)
        .eq('broker_account_id', scope.brokerAccountId)
        .eq('status', 'broker_pending');
    if (error || !data?.length)
        return 0;
    const platform = await (0, mtApiByAccount_1.loadPlatformByFxsocketId)(supabase, data.map(r => r.metaapi_account_id));
    let cancelled = 0;
    const byAccount = new Map();
    for (const row of data) {
        const list = byAccount.get(row.metaapi_account_id) ?? [];
        list.push(row);
        byAccount.set(row.metaapi_account_id, list);
    }
    const signalNeedle = scope.signalId.slice(0, 8);
    for (const [uuid, rows] of byAccount) {
        const api = (0, mtApiByAccount_1.apiForFxsocketAccount)(platform, uuid);
        if (!api)
            continue;
        for (const row of rows) {
            const ok = await (0, rangeBrokerPendingHelpers_1.cancelBrokerRangeLegAtBroker)(supabase, api, row, reason);
            if (ok)
                cancelled += 1;
        }
        // Sweep leftover limit tickets whose comment still references this signal
        // (covers ticket mismatch / failed OrderClose leaving orphans on the chart).
        try {
            const opened = await api.openedOrders(uuid);
            const closedTickets = new Set();
            for (const raw of opened) {
                if (!raw || typeof raw !== 'object')
                    continue;
                const o = raw;
                if (!(0, signalEntryPendingHelpers_1.isPendingEntryRow)(o))
                    continue;
                const comment = readComment(raw);
                if (!comment.includes(signalNeedle) && !comment.includes(scope.signalId))
                    continue;
                const ticket = (0, signalEntryPendingHelpers_1.rawOrderTicket)(o);
                if (!(ticket > 0) || closedTickets.has(ticket))
                    continue;
                try {
                    await api.orderClose(uuid, { ticket });
                    closedTickets.add(ticket);
                    cancelled += 1;
                    console.log(`[rangePendingLegDelete] swept orphan limit ticket=${ticket}`
                        + ` signal=${scope.signalId} reason=${reason}`);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn(`[rangePendingLegDelete] orphan limit OrderClose failed ticket=${ticket}`
                        + ` signal=${scope.signalId}: ${msg}`);
                }
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[rangePendingLegDelete] OpenedOrders sweep failed signal=${scope.signalId}: ${msg}`);
        }
    }
    return cancelled;
}
/** Delete all active virtual / broker ladder rows for a basket (any symbol spelling). */
async function deleteRangePendingLegsForBasket(supabase, scope, reason) {
    const brokerCancelled = await cancelBrokerPendingLegsForScope(supabase, scope, reason);
    const { data, error } = await supabase
        .from('range_pending_legs')
        .delete()
        .eq('signal_id', scope.signalId)
        .eq('broker_account_id', scope.brokerAccountId)
        .in('status', ['pending', 'claimed', 'broker_pending', 'cancelled'])
        .select('id');
    if (error) {
        // Fallback: still clear actives if cancelled-inclusive delete is rejected.
        const { data: activeOnly, error: activeErr } = await supabase
            .from('range_pending_legs')
            .delete()
            .eq('signal_id', scope.signalId)
            .eq('broker_account_id', scope.brokerAccountId)
            .in('status', ['pending', 'claimed', 'broker_pending'])
            .select('id');
        if (activeErr) {
            console.warn(`[rangePendingLegDelete] delete failed signal=${scope.signalId} broker=${scope.brokerAccountId}: ${activeErr.message}`);
            return brokerCancelled;
        }
        const n = (activeOnly ?? []).length;
        if (n > 0 || brokerCancelled > 0) {
            console.log(`[rangePendingLegDelete] deleted ${n} range_pending_legs`
                + ` broker_cancelled=${brokerCancelled}`
                + ` signal=${scope.signalId} broker=${scope.brokerAccountId} reason=${reason}`);
        }
        return Math.max(n, brokerCancelled);
    }
    const n = (data ?? []).length;
    if (n > 0 || brokerCancelled > 0) {
        console.log(`[rangePendingLegDelete] deleted ${n} range_pending_legs`
            + ` broker_cancelled=${brokerCancelled}`
            + ` signal=${scope.signalId} broker=${scope.brokerAccountId} reason=${reason}`);
    }
    return Math.max(n, brokerCancelled);
}
/** Delete pending/claimed legs when no open/pending trades remain in DB for the basket. */
async function purgeRangePendingLegsIfBasketFlat(supabase, scope, reason) {
    const { count, error } = await supabase
        .from('trades')
        .select('id', { count: 'exact', head: true })
        .eq('signal_id', scope.signalId)
        .eq('broker_account_id', scope.brokerAccountId)
        .in('status', ['open', 'pending']);
    if (error) {
        console.warn(`[rangePendingLegDelete] flat-check failed signal=${scope.signalId}: ${error.message}`);
        return 0;
    }
    if ((count ?? 0) > 0)
        return 0;
    const deleted = await deleteRangePendingLegsForBasket(supabase, scope, reason);
    if (deleted > 0) {
        await (0, rangePendingFireGuard_1.clearTpTouchedLock)(supabase, scope);
    }
    return deleted;
}
async function purgeRangePendingLegsForBaskets(supabase, scopes, reason) {
    const uniq = new Map();
    for (const s of scopes) {
        uniq.set(`${s.signalId}|${s.brokerAccountId}`, s);
    }
    let total = 0;
    for (const scope of uniq.values()) {
        total += await purgeRangePendingLegsIfBasketFlat(supabase, scope, reason);
    }
    return total;
}
