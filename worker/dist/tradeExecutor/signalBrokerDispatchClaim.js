"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDuplicateKeyError = isDuplicateKeyError;
exports.claimSignalBrokerDispatch = claimSignalBrokerDispatch;
exports.releaseSignalBrokerDispatchClaim = releaseSignalBrokerDispatchClaim;
function isDuplicateKeyError(error) {
    if (!error)
        return false;
    if (error.code === '23505')
        return true;
    const msg = (error.message ?? '').toLowerCase();
    return msg.includes('duplicate key') || msg.includes('unique constraint');
}
/**
 * Claim exclusive entry dispatch for signal+broker before OrderSend.
 * Returns false when another worker already claimed the dispatch or when the
 * database cannot confirm that this worker owns the claim. An uncertain claim
 * must never be treated as permission to place a broker order.
 */
async function claimSignalBrokerDispatch(supabase, signalId, brokerAccountId, userId) {
    const { error } = await supabase.from('signal_broker_dispatch_claims').insert({
        signal_id: signalId,
        broker_account_id: brokerAccountId,
    });
    if (!error)
        return true;
    if (isDuplicateKeyError(error))
        return false;
    console.warn(`[tradeExecutor] signal_broker_dispatch_claim insert failed signal=${signalId} broker=${brokerAccountId}: ${error.message}`);
    if (!userId) {
        return false;
    }
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: userId,
            signal_id: signalId,
            broker_account_id: brokerAccountId,
            action: 'dispatch_claim_error',
            status: 'failed',
            error_message: error.message,
            request_payload: {
                signal_id: signalId,
                broker_account_id: brokerAccountId,
                fail_closed: true,
            },
        });
    }
    catch { /* best-effort */ }
    return false;
}
/** Release a prior claim so range-wake or retry can dispatch orders. */
async function releaseSignalBrokerDispatchClaim(supabase, signalId, brokerAccountId) {
    const { error } = await supabase
        .from('signal_broker_dispatch_claims')
        .delete()
        .eq('signal_id', signalId)
        .eq('broker_account_id', brokerAccountId);
    if (error) {
        console.warn(`[tradeExecutor] signal_broker_dispatch_claim release failed signal=${signalId} broker=${brokerAccountId}: ${error.message}`);
    }
}
