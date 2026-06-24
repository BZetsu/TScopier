"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvalidStopsError = isInvalidStopsError;
exports.modifyLegSlTpWithFallback = modifyLegSlTpWithFallback;
/**
 * SL-first OrderModify with a split fallback.
 *
 * MT4/MT5 bridges reject the WHOLE OrderModify if EITHER the SL or TP is invalid
 * (e.g. a fast market has already passed the nearest TP, or the level is inside
 * the broker stops/freeze band). Sending SL+TP together therefore meant an
 * invalid TP left the leg with NEITHER stop — a naked position. This helper tries
 * the combined modify once, and on an "invalid stops" rejection retries SL-only
 * (protect the position first) then TP-only (best-effort).
 */
const orderModifyBenign_1 = require("./orderModifyBenign");
function isInvalidStopsError(message) {
    const m = (message ?? '').trim();
    if (!m)
        return false;
    return (/invalid\s*stops?/i.test(m)
        || /invalid\s*s\s*\/?\s*l/i.test(m)
        || /invalid\s*t\s*\/?\s*p/i.test(m)
        || /invalid\s*(stop\s*loss|take\s*profit)/i.test(m)
        || /stops?\s+too\s+close/i.test(m)
        || /wrong\s+stops?/i.test(m));
}
/**
 * Apply SL/TP to one leg, never letting an invalid TP block the protective SL.
 * Pass 0 (or a non-positive value) for a side to skip it.
 */
async function modifyLegSlTpWithFallback(api, uuid, ticket, stoploss, takeprofit, opts) {
    const hasSl = Number.isFinite(stoploss) && stoploss > 0;
    const hasTp = Number.isFinite(takeprofit) && takeprofit > 0;
    if (!hasSl && !hasTp) {
        return { ok: false, slApplied: false, tpApplied: false, appliedSl: 0, appliedTp: 0, mode: 'none' };
    }
    try {
        const result = await api.orderModify(uuid, {
            ticket,
            ...(hasSl ? { stoploss } : {}),
            ...(hasTp ? { takeprofit } : {}),
        });
        return {
            ok: true,
            slApplied: hasSl,
            tpApplied: hasTp,
            appliedSl: hasSl ? stoploss : 0,
            appliedTp: hasTp ? takeprofit : 0,
            mode: 'combined',
            result,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((0, orderModifyBenign_1.isBenignOrderModifyError)(msg)) {
            return {
                ok: true,
                slApplied: hasSl,
                tpApplied: hasTp,
                appliedSl: hasSl ? stoploss : 0,
                appliedTp: hasTp ? takeprofit : 0,
                mode: 'combined',
            };
        }
        // Only splitting helps an invalid-stops rejection, and only when both sides
        // were requested. Timeouts / unknown-ticket / disconnects are returned as-is
        // so the caller's existing transient handling and reconcile fallback apply.
        if (!isInvalidStopsError(msg) || !(hasSl && hasTp)) {
            return { ok: false, slApplied: false, tpApplied: false, appliedSl: 0, appliedTp: 0, mode: 'combined', error: msg };
        }
        // SL first — protecting the position is the priority.
        let slApplied = false;
        let slErr;
        let slResult;
        try {
            slResult = await api.orderModify(uuid, { ticket, stoploss });
            slApplied = true;
        }
        catch (e) {
            const m2 = e instanceof Error ? e.message : String(e);
            if ((0, orderModifyBenign_1.isBenignOrderModifyError)(m2))
                slApplied = true;
            else
                slErr = m2;
        }
        // TP best-effort: try the requested TP, then (if price passed it) the deepest
        // ladder TP so the leg still carries a profit target rather than none.
        const deepest = opts?.deepestTp;
        const tpCandidates = [takeprofit];
        if (deepest != null && Number.isFinite(deepest) && deepest > 0 && deepest !== takeprofit) {
            tpCandidates.push(deepest);
        }
        let tpApplied = false;
        let appliedTp = 0;
        for (const candidate of tpCandidates) {
            try {
                await api.orderModify(uuid, { ticket, takeprofit: candidate });
                tpApplied = true;
                appliedTp = candidate;
                break;
            }
            catch (e) {
                const m3 = e instanceof Error ? e.message : String(e);
                if ((0, orderModifyBenign_1.isBenignOrderModifyError)(m3)) {
                    tpApplied = true;
                    appliedTp = candidate;
                    break;
                }
                // otherwise try the next (deeper) candidate
            }
        }
        return {
            ok: slApplied || tpApplied,
            slApplied,
            tpApplied,
            appliedSl: slApplied ? stoploss : 0,
            appliedTp,
            mode: 'split',
            result: slResult,
            error: slApplied ? undefined : (slErr ?? msg),
        };
    }
}
