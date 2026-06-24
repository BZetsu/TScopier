"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeOrderFast = closeOrderFast;
exports.closeWithVerification = closeWithVerification;
const signalEntryPendingHelpers_1 = require("./signalEntryPendingHelpers");
function mgmtCloseVerifySleepMs(liveFast) {
    if (liveFast) {
        const raw = Number(process.env.MGMT_CLOSE_VERIFY_MS ?? 0);
        return Number.isFinite(raw) && raw >= 0 ? raw : 0;
    }
    return 400;
}
/** Single orderClose — no post-close openedOrders poll (live fast tier). */
async function closeOrderFast(api, uuid, ticket, slippage = 20) {
    const result = await api.orderClose(uuid, { ticket, slippage });
    if (result.state && /^(rejected|cancelled|expired)/i.test(result.state)) {
        return { confirmed: false, reason: `orderClose state=${result.state}`, attempts: 1 };
    }
    return { confirmed: true, attempts: 1 };
}
async function closeWithVerification(api, uuid, ticket, opts = {}) {
    const liveFast = opts.liveFast === true;
    const verifySleepMs = mgmtCloseVerifySleepMs(liveFast);
    // #region agent log
    const _cwvStart = Date.now();
    fetch('http://127.0.0.1:7911/ingest/9eb853c4-6a95-4829-9e4e-863df98c5251', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '89d082' }, body: JSON.stringify({ sessionId: '89d082', hypothesisId: 'H1', location: 'managementClose.ts:closeWithVerification', message: 'close path', data: { ticket, liveFast, verifySleepMs, maxAttempts: opts.maxAttempts ?? (liveFast && verifySleepMs === 0 ? 2 : 2) }, timestamp: _cwvStart }) }).catch(() => { });
    // #endregion
    if (liveFast && verifySleepMs === 0) {
        const maxAttempts = opts.maxAttempts ?? 2;
        const slippageStep = opts.slippageEscalation ?? 50;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const slippage = 20 + (attempt - 1) * slippageStep;
            const result = await closeOrderFast(api, uuid, ticket, slippage);
            if (result.confirmed)
                return { ...result, attempts: attempt };
            if (attempt >= maxAttempts)
                return result;
        }
        return { confirmed: false, reason: 'exhausted attempts', attempts: maxAttempts };
    }
    const maxAttempts = opts.maxAttempts ?? 2;
    const slippageStep = opts.slippageEscalation ?? 50;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const slippage = 20 + (attempt - 1) * slippageStep;
        const result = await api.orderClose(uuid, { ticket, slippage });
        if (result.state && /^(rejected|cancelled|expired)/i.test(result.state)) {
            if (attempt >= maxAttempts) {
                return { confirmed: false, reason: `orderClose state=${result.state}`, attempts: attempt };
            }
            await new Promise(r => setTimeout(r, 300));
            continue;
        }
        if (verifySleepMs > 0) {
            await new Promise(r => setTimeout(r, verifySleepMs));
        }
        let stillOpen = false;
        try {
            const openOrders = await api.openedOrders(uuid);
            stillOpen = (0, signalEntryPendingHelpers_1.findOpenedRowByTicket)(openOrders ?? [], ticket) != null;
        }
        catch {
            return { confirmed: true, attempts: attempt };
        }
        if (!stillOpen) {
            return { confirmed: true, attempts: attempt };
        }
        if (attempt >= maxAttempts) {
            return { confirmed: false, reason: 'ticket still open after orderClose + verification', attempts: attempt };
        }
        await new Promise(r => setTimeout(r, 300));
    }
    return { confirmed: false, reason: 'exhausted attempts', attempts: maxAttempts };
}
