"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimSignalBrokerDispatch = claimSignalBrokerDispatch;
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
 * Returns false when another worker already claimed or materialized the dispatch.
 */
async function claimSignalBrokerDispatch(supabase, signalId, brokerAccountId) {
    const { error } = await supabase.from('signal_broker_dispatch_claims').insert({
        signal_id: signalId,
        broker_account_id: brokerAccountId,
    });
    if (!error)
        return true;
    if (isDuplicateKeyError(error))
        return false;
    console.warn(`[tradeExecutor] signal_broker_dispatch_claim insert failed signal=${signalId} broker=${brokerAccountId}: ${error.message}`);
    return true;
}
