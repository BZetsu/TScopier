"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOrderCloseAuditSink = registerOrderCloseAuditSink;
exports.registerOrderCloseAuditSupabase = registerOrderCloseAuditSupabase;
exports.auditOrderClose = auditOrderClose;
let sink = null;
const userIdByFxAccount = new Map();
/** Register from worker boot so closes can persist to trade_execution_logs. */
function registerOrderCloseAuditSink(next) {
    sink = next;
}
function registerOrderCloseAuditSupabase(supabase) {
    registerOrderCloseAuditSink((event) => {
        void (async () => {
            // The audit event only carries the FxSocket account id + ticket, but
            // trade_execution_logs requires user_id (NOT NULL) and signal_id.
            // Resolve user_id from broker_accounts (fxsocket_account_id) and, when
            // possible, signal_id from the owning trades row. If no user can be
            // resolved the DB write is skipped (console trail remains).
            let userId = userIdByFxAccount.get(event.accountId);
            let signalId = null;
            if (!userId) {
                const { data: account } = await supabase
                    .from('broker_accounts')
                    .select('id, user_id')
                    .eq('fxsocket_account_id', event.accountId)
                    .maybeSingle();
                const acc = account;
                userId = acc?.user_id ?? undefined;
                if (userId)
                    userIdByFxAccount.set(event.accountId, userId);
                if (acc?.id) {
                    const { data: trade } = await supabase
                        .from('trades')
                        .select('signal_id')
                        .eq('broker_account_id', acc.id)
                        .eq('metaapi_order_id', String(event.ticket))
                        .maybeSingle();
                    signalId = (trade?.signal_id) ?? null;
                }
            }
            if (!userId) {
                console.warn(`[orderCloseAudit] skip persist — no user_id for fx account=${event.accountId}`);
                return;
            }
            const { error } = await supabase.from('trade_execution_logs').insert({
                user_id: userId,
                ...(signalId ? { signal_id: signalId } : {}),
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
            });
            if (error) {
                console.warn(`[orderCloseAudit] persist failed: ${error.message}`);
            }
        })();
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
