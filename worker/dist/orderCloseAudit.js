"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOrderCloseAuditSink = registerOrderCloseAuditSink;
exports.registerOrderCloseAuditSupabase = registerOrderCloseAuditSupabase;
exports.auditOrderClose = auditOrderClose;
let sink = null;
/** Register from worker boot so closes can persist to trade_execution_logs. */
function registerOrderCloseAuditSink(next) {
    sink = next;
}
function registerOrderCloseAuditSupabase(supabase) {
    registerOrderCloseAuditSink((event) => {
        void supabase
            .from('trade_execution_logs')
            .insert({
            action: 'order_close_audit',
            status: event.ok === false ? 'failed' : 'success',
            request_payload: {
                source: event.source,
                account_id: event.accountId,
                ticket: event.ticket,
                volume: event.volume ?? null,
                slippage: event.slippage ?? null,
                message: event.message ?? null,
                stack: event.stack.slice(0, 4000),
            },
            error_message: event.ok === false ? (event.message ?? 'orderClose failed') : null,
        })
            .then(({ error }) => {
            if (error) {
                console.warn(`[orderCloseAudit] persist failed: ${error.message}`);
            }
        });
    });
}
/** Always log; optionally persist via registered sink. */
function auditOrderClose(event) {
    const stack = (new Error('orderClose').stack ?? '').split('\n').slice(2, 18).join('\n');
    console.warn(`[orderCloseAudit] source=${event.source} account=${event.accountId}`
        + ` ticket=${event.ticket} volume=${event.volume ?? 'full'}`
        + ` ok=${event.ok ?? 'pending'}`
        + (event.message ? ` msg=${event.message}` : '')
        + `\n${stack}`);
    try {
        sink?.({ ...event, stack });
    }
    catch (err) {
        console.warn(`[orderCloseAudit] sink error: ${err.message}`);
    }
}
