"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeReconcileActions = computeReconcileActions;
exports.applyReconcileActions = applyReconcileActions;
const fxContract_1 = require("./fxContract");
function approxEq(a, b, eps) {
    if (a == null && b == null)
        return true;
    if (a == null || b == null)
        return false;
    return Math.abs(a - b) <= eps;
}
/**
 * Pure diff: what minimal set of broker actions brings the basket to desired state?
 * A leg is only modified when a desired side (SL or TP) differs from the broker by
 * more than `epsilon`; if both already match, nothing is emitted (idempotent no-op).
 */
function computeReconcileActions(args) {
    const eps = args.epsilon ?? 1e-6;
    const magic = args.ourMagic ?? fxContract_1.TSCOPIER_MAGIC;
    const allowTp = args.allowTpModify !== false;
    const openByTicket = new Map();
    for (const o of args.openOrders)
        openByTicket.set(o.ticket, o);
    const modifies = [];
    for (const d of args.desired) {
        const o = openByTicket.get(d.ticket);
        if (!o)
            continue; // not at broker -> handled by closedTickets below
        const wantSl = d.stoploss != null && d.stoploss > 0 ? d.stoploss : null;
        const wantTp = allowTp && d.takeProfit != null && d.takeProfit > 0 ? d.takeProfit : null;
        const slDrift = wantSl != null && !approxEq(o.stopLoss, wantSl, eps);
        const tpDrift = wantTp != null && !approxEq(o.takeProfit, wantTp, eps);
        if (slDrift || tpDrift) {
            modifies.push({ ticket: d.ticket, stoploss: slDrift ? wantSl : null, takeProfit: tpDrift ? wantTp : null });
        }
    }
    const tracked = new Set(args.trackedTickets);
    const closedTickets = args.trackedTickets.filter(t => !openByTicket.has(t));
    const adopt = args.openOrders.filter(o => !tracked.has(o.ticket) && o.magic === magic);
    return { modifies, adopt, closedTickets };
}
/** Execute a computed diff via the strict client. SL-first on INVALID_STOPS so a bad
 * TP never blocks the protective SL. Modifies run within the client's per-terminal gate. */
async function applyReconcileActions(deps, actions) {
    let modified = 0;
    let modifyFailed = 0;
    for (const m of actions.modifies) {
        const combined = await deps.fx.orderModify(deps.accountId, deps.platform, {
            ticket: m.ticket,
            stopLoss: m.stoploss ?? undefined,
            takeProfit: m.takeProfit ?? undefined,
        });
        if (combined.ok) {
            modified++;
            continue;
        }
        // If the combined modify was rejected for stops/price, protect the SL alone.
        if ((0, fxContract_1.isInvalidStopsRetcode)(combined.retcode) && m.stoploss != null && m.takeProfit != null) {
            const slOnly = await deps.fx.orderModify(deps.accountId, deps.platform, { ticket: m.ticket, stopLoss: m.stoploss });
            if (slOnly.ok) {
                modified++;
                continue;
            }
        }
        modifyFailed++;
    }
    let closed = 0;
    for (const ticket of actions.closedTickets) {
        await deps.markClosed(ticket).then(() => { closed++; }).catch(() => { });
    }
    let adopted = 0;
    for (const o of actions.adopt) {
        await deps.adoptOrphan(o).then(() => { adopted++; }).catch(() => { });
    }
    return { modified, modifyFailed, closed, adopted };
}
