"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverOneNativeLayeringSubmission = recoverOneNativeLayeringSubmission;
exports.recoverNativeLayeringSubmissions = recoverNativeLayeringSubmissions;
const layeringPlanPersistence_1 = require("../manualPlanning/layeringPlanPersistence");
const layeringModeBrokerPending_1 = require("./layeringModeBrokerPending");
const RECOVERY_STATUSES = ['submission_claimed', 'submission_ambiguous', 'reconciliation_required', 'submitted'];
const DEFAULT_RECOVERY_LEASE_TIMEOUT_MS = 5 * 60 * 1000;
function nowIso() {
    return new Date().toISOString();
}
function recoveryLeaseTimeoutMs() {
    const raw = Number(process.env.LAYERING_NATIVE_RECOVERY_LEASE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60 * 60 * 1000) : DEFAULT_RECOVERY_LEASE_TIMEOUT_MS;
}
function recoveryLeaseExpired(row, nowMs = Date.now()) {
    if (!row.reconciliation_claimed_by)
        return true;
    if (!row.reconciliation_claimed_at)
        return false;
    const claimedAt = Date.parse(row.reconciliation_claimed_at);
    return Number.isFinite(claimedAt) && claimedAt <= nowMs - recoveryLeaseTimeoutMs();
}
function planMatchesRow(snapshot, row, fingerprint) {
    const expected = (0, layeringPlanPersistence_1.computeLayeringPlanFingerprint)(snapshot);
    if (!expected || fingerprint !== expected)
        return false;
    const idx = row.step_idx - 1;
    return (snapshot.planId === row.layer_plan_id
        && snapshot.signalId === row.signal_id
        && snapshot.brokerAccountId === row.broker_account_id
        && snapshot.symbol === row.symbol
        && (snapshot.side === 'buy') === row.is_buy
        && snapshot.fundedPrices != null
        && snapshot.lots != null
        && idx >= 0
        && snapshot.fundedPrices[idx] === row.trigger_price
        && snapshot.lots[idx] === row.volume);
}
async function claimRecovery(supabase, row, owner) {
    const patch = {
        native_submission_status: 'reconciliation_required',
        reconciliation_claimed_at: nowIso(),
        reconciliation_claimed_by: owner,
        reconciliation_reason: 'startup_recovery',
    };
    const first = await supabase
        .from('range_pending_legs')
        .update(patch)
        .eq('id', row.id)
        .eq('status', 'broker_pending')
        .in('native_submission_status', [...RECOVERY_STATUSES])
        .is('reconciliation_claimed_by', null)
        .select('id')
        .maybeSingle();
    if (!first.error && first.data)
        return true;
    if (!recoveryLeaseExpired(row))
        return false;
    if (!row.reconciliation_claimed_by || !row.reconciliation_claimed_at)
        return false;
    const { data, error } = await supabase
        .from('range_pending_legs')
        .update(patch)
        .eq('id', row.id)
        .eq('status', 'broker_pending')
        .in('native_submission_status', [...RECOVERY_STATUSES])
        .eq('reconciliation_claimed_by', row.reconciliation_claimed_by)
        .eq('reconciliation_claimed_at', row.reconciliation_claimed_at)
        .select('id')
        .maybeSingle();
    return !error && Boolean(data);
}
function recoveryPrep(args) {
    return {
        api: args.api,
        ctx: { supabase: args.supabase },
        signal: { id: args.snapshot.signalId, user_id: args.row.user_id },
        broker: {
            id: args.snapshot.brokerAccountId,
            platform: 'MT5',
            fxsocket_account_id: args.row.metaapi_account_id,
            connection_status: 'connected',
            trade_allowed: true,
        },
        uuid: args.row.metaapi_account_id,
        symbol: args.snapshot.symbol,
        params: { digits: 8, point: 0.00001, stopsLevel: 0, freezeLevel: 0, minLot: 0.01, maxLot: 100, lotStep: 0.01 },
        manual: { range_layering_type: 'pending_order' },
        commentPrefix: 'TScopier:recovery',
        legs: [],
    };
}
async function recoverOneNativeLayeringSubmission(args) {
    const { data: plan, error } = await args.supabase
        .from('layering_plans')
        .select('status,semantic_fingerprint,layer_plan_metadata')
        .eq('layer_plan_id', args.row.layer_plan_id)
        .maybeSingle();
    if (error || !plan)
        return 'invalid';
    const planStatus = String(plan.status ?? '');
    if (planStatus !== 'active' && planStatus !== 'cancelling' && planStatus !== 'cancellation_pending')
        return 'none';
    const parsed = (0, layeringPlanPersistence_1.parsePersistedLayeringPlan)(plan.layer_plan_metadata);
    if (!parsed.ok || !planMatchesRow(parsed.snapshot, args.row, plan.semantic_fingerprint)) {
        await args.supabase
            .from('layering_plans')
            .update({ status: 'invalid', cancellation_reason: 'native_recovery_plan_mismatch', updated_at: nowIso() })
            .eq('layer_plan_id', args.row.layer_plan_id)
            .in('status', ['prepared', 'activating', 'active', 'cancelling', 'cancellation_pending']);
        return 'invalid';
    }
    if (!args.api)
        return 'unsupported';
    const owner = args.owner ?? `layering-recovery:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (!await claimRecovery(args.supabase, args.row, owner))
        return 'claim_lost';
    const operation = (0, layeringModeBrokerPending_1.brokerPendingOperationForLayer)(parsed.snapshot.side);
    const expectedReference = (0, layeringModeBrokerPending_1.buildLayeringBrokerPendingClientReference)({
        planId: parsed.snapshot.planId,
        stepIdx: args.row.step_idx,
        brokerAccountId: parsed.snapshot.brokerAccountId,
    });
    if (args.row.broker_client_reference && args.row.broker_client_reference !== expectedReference) {
        await args.supabase
            .from('layering_plans')
            .update({ status: 'invalid', cancellation_reason: 'native_recovery_reference_mismatch', updated_at: nowIso() })
            .eq('layer_plan_id', args.row.layer_plan_id)
            .in('status', ['prepared', 'activating', 'active', 'cancelling', 'cancellation_pending']);
        return 'invalid';
    }
    const prep = recoveryPrep({ supabase: args.supabase, api: args.api, row: args.row, snapshot: parsed.snapshot });
    const result = await (0, layeringModeBrokerPending_1.reconcileNativePendingLegByReference)({
        prep,
        snapshot: parsed.snapshot,
        row: {
            ...args.row,
            broker_client_reference: expectedReference,
            broker_pending_type: args.row.broker_pending_type ?? operation,
            native_submission_status: 'reconciliation_required',
            submission_claimed_by: owner,
        },
        reference: expectedReference,
        operation,
        owner,
        manualReviewOnMissingReference: true,
    });
    if (result.ok)
        return 'reconciliation_adopted';
    if (result.outcome === 'reconciliation_conflict')
        return 'reconciliation_conflict';
    if (result.outcome === 'manual_review_required')
        return 'manual_review_required';
    return 'reconciliation_pending';
}
async function recoverNativeLayeringSubmissions(args) {
    const { data, error } = await args.supabase
        .from('range_pending_legs')
        .select('id,layer_plan_id,layer_plan_metadata,signal_id,user_id,broker_account_id,metaapi_account_id,symbol,step_idx,is_buy,volume,trigger_price,ticket,broker_client_reference,broker_pending_type,native_submission_status,submission_claimed_by,reconciliation_claimed_at,reconciliation_claimed_by')
        .eq('status', 'broker_pending')
        .in('native_submission_status', [...RECOVERY_STATUSES])
        .limit(100);
    if (error || !data?.length)
        return { scanned: 0, recovered: 0, unresolved: 0, invalid: 0 };
    let recovered = 0;
    let unresolved = 0;
    let invalid = 0;
    for (const row of data) {
        if (!row.layer_plan_id)
            continue;
        const outcome = await recoverOneNativeLayeringSubmission({
            supabase: args.supabase,
            row,
            api: args.apiLookup(row.metaapi_account_id),
        });
        if (outcome === 'reconciliation_adopted')
            recovered += 1;
        else if (outcome === 'invalid' || outcome === 'reconciliation_conflict')
            invalid += 1;
        else if (outcome !== 'none' && outcome !== 'claim_lost')
            unresolved += 1;
    }
    return { scanned: data.length, recovered, unresolved, invalid };
}
