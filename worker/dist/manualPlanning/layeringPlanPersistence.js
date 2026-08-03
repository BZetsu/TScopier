"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLayerPlanId = generateLayerPlanId;
exports.computeLayeringPlanFingerprint = computeLayeringPlanFingerprint;
exports.areLayeringPlansSemanticallyEqual = areLayeringPlansSemanticallyEqual;
exports.buildLayeringPlanSnapshot = buildLayeringPlanSnapshot;
exports.snapshotsMatch = snapshotsMatch;
exports.parsePersistedLayeringPlan = parsePersistedLayeringPlan;
exports.loadLayeringPlan = loadLayeringPlan;
exports.persistLayeringPlan = persistLayeringPlan;
exports.claimLayeringPlanActivation = claimLayeringPlanActivation;
exports.activateLayeringPlanWithLegs = activateLayeringPlanWithLegs;
exports.materializeLayerPlanLegRows = materializeLayerPlanLegRows;
exports.materializeExecutableLayerPlanLegRows = materializeExecutableLayerPlanLegRows;
exports.recoverLayeringPlan = recoverLayeringPlan;
const node_crypto_1 = require("node:crypto");
const layeringModes_1 = require("./layeringModes");
function canonicalIdentityValue(value, options) {
    if (value == null) {
        if (options?.required)
            return null;
        return value === null ? { kind: 'null' } : { kind: 'undefined' };
    }
    if (typeof value !== 'string')
        return null;
    for (const char of value) {
        const code = char.charCodeAt(0);
        if (code < 32 || code === 127)
            return null;
    }
    const trimmed = value.trim();
    if (options?.required && trimmed.length === 0)
        return null;
    if (trimmed.length > 256)
        return null;
    return { kind: 'value', value: options?.normalizeUpper ? trimmed.toUpperCase() : trimmed };
}
function identityTuple(identity) {
    const signalId = canonicalIdentityValue(identity.signalId, { required: true });
    const brokerAccountId = canonicalIdentityValue(identity.brokerAccountId, { required: true });
    const basketKey = canonicalIdentityValue(identity.basketKey);
    const symbol = canonicalIdentityValue(identity.symbol, { required: true, normalizeUpper: true });
    if (signalId == null
        || brokerAccountId == null
        || basketKey == null
        || symbol == null
        || (identity.side !== 'buy' && identity.side !== 'sell')
        || (identity.mode !== 'static' && identity.mode !== 'dynamic'))
        return null;
    return Object.freeze({
        signalId,
        brokerAccountId,
        basketKey,
        symbol,
        side: identity.side,
        mode: identity.mode,
    });
}
function generateLayerPlanId(identity) {
    const tuple = identityTuple(identity);
    if (tuple == null)
        return null;
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update(stableStringify(tuple), 'utf8')
        .digest('base64url')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 32);
    const planId = `layerplan_${digest}`;
    return (0, layeringModes_1.isValidLayerPlanId)(planId) ? planId : null;
}
function isoTimestamp(value) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return null;
    const iso = new Date(ms).toISOString();
    return iso === value ? value : null;
}
function uniqueReasons(reasons) {
    return Object.freeze([...new Set(reasons)]);
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    if (value != null && typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function canonicalSemanticSnapshot(snapshot) {
    const metadata = (0, layeringModes_1.serializeLayeringPlanSnapshot)(snapshot);
    if (metadata == null)
        return null;
    const semantic = { ...metadata };
    delete semantic.createdAt;
    delete semantic.lockedAt;
    return semantic;
}
function computeLayeringPlanFingerprint(snapshot) {
    const semantic = canonicalSemanticSnapshot(snapshot);
    if (semantic == null)
        return null;
    return (0, node_crypto_1.createHash)('sha256').update(stableStringify(semantic), 'utf8').digest('base64url');
}
function areLayeringPlansSemanticallyEqual(a, b) {
    const left = computeLayeringPlanFingerprint(a);
    const right = computeLayeringPlanFingerprint(b);
    return left != null && left === right;
}
function buildLayeringPlanSnapshot(input) {
    if (!(0, layeringModes_1.isValidLayerPlanId)(input.planId))
        return { ok: false, reason: 'invalid_plan_id' };
    if (identityTuple(input) == null)
        return { ok: false, reason: 'invalid_identity' };
    if (!input.calculatedPlan.ok || input.calculatedPlan.mode !== input.mode)
        return { ok: false, reason: 'invalid_calculated_plan' };
    if (input.calculatedPlan.fundedPrices.length === 0 || input.calculatedPlan.fundedPrices.length !== input.calculatedPlan.lots.length) {
        return { ok: false, reason: 'invalid_calculated_plan' };
    }
    if (input.calculatedPlan.actualLayerCount !== input.calculatedPlan.fundedPrices.length) {
        return { ok: false, reason: 'invalid_calculated_plan' };
    }
    if (input.calculatedPlan.allocatedTotalLot > input.calculatedPlan.intendedTotalLot) {
        return { ok: false, reason: 'invalid_calculated_plan' };
    }
    const createdAt = isoTimestamp(input.createdAt);
    const lockedAt = isoTimestamp(input.lockedAt ?? input.createdAt);
    if (createdAt == null || lockedAt == null || Date.parse(lockedAt) < Date.parse(createdAt)) {
        return { ok: false, reason: 'invalid_snapshot' };
    }
    const snapshot = {
        schemaVersion: layeringModes_1.LAYERING_PLAN_SCHEMA_VERSION,
        calculatorVersion: layeringModes_1.LAYERING_PLAN_CALCULATOR_VERSION,
        planId: input.planId,
        mode: input.mode,
        signalId: input.signalId,
        brokerAccountId: input.brokerAccountId,
        basketKey: input.basketKey?.trim() ?? null,
        symbol: input.symbol.trim().toUpperCase(),
        side: input.side,
        originalRangeLow: input.calculatedPlan.rangeLow,
        originalRangeHigh: input.calculatedPlan.rangeHigh,
        anchorPrice: input.calculatedPlan.rawAnchorPrice,
        executableAnchorPrice: input.calculatedPlan.executableAnchorPrice,
        anchorSource: input.anchorSource,
        configuredStaticLayerCount: input.mode === 'static' ? input.configuredStaticLayerCount ?? input.calculatedPlan.requestedLayerCount : null,
        configuredDynamicStepPips: input.mode === 'dynamic' ? input.configuredDynamicStepPips ?? null : null,
        configuredDynamicMaxLayers: input.mode === 'dynamic' ? input.configuredDynamicMaxLayers ?? input.calculatedPlan.requestedLayerCount : null,
        optimizationStrategy: input.calculatedPlan.optimizationStrategy,
        theoreticalLayerCount: input.calculatedPlan.theoreticalLayerCount,
        effectiveStepPips: input.calculatedPlan.effectiveStepPips,
        requestedLayerPercent: input.calculatedPlan.requestedLayerPercent,
        effectiveLayerPercent: input.calculatedPlan.effectiveLayerPercent,
        allocationPercentTotal: input.calculatedPlan.allocationPercentTotal,
        requestedLayerCount: input.calculatedPlan.requestedLayerCount,
        plannedLayerCount: input.calculatedPlan.actualLayerCount,
        plannedTotalLot: input.calculatedPlan.intendedTotalLot,
        allocatedTotalLot: input.calculatedPlan.allocatedTotalLot,
        unallocatedLot: input.calculatedPlan.unallocatedLot,
        fundedPrices: Object.freeze([...input.calculatedPlan.fundedPrices]),
        lots: Object.freeze([...input.calculatedPlan.lots]),
        reasons: uniqueReasons(input.calculatedPlan.reasons),
        createdAt,
        lockedAt,
    };
    const parsed = (0, layeringModes_1.parseLayeringPlanSnapshot)(snapshot);
    return parsed == null ? { ok: false, reason: 'invalid_snapshot' } : { ok: true, snapshot: parsed };
}
function snapshotsMatch(a, b) {
    return areLayeringPlansSemanticallyEqual(a, b);
}
function parsePersistedLayeringPlan(raw) {
    try {
        if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
            const row = raw;
            if (row.schemaVersion !== undefined && row.schemaVersion !== layeringModes_1.LAYERING_PLAN_SCHEMA_VERSION) {
                return { ok: false, reason: 'unsupported_version' };
            }
            if (row.calculatorVersion !== undefined && row.calculatorVersion !== layeringModes_1.LAYERING_PLAN_CALCULATOR_VERSION) {
                return { ok: false, reason: 'unsupported_version' };
            }
        }
    }
    catch {
        return { ok: false, reason: 'malformed_metadata' };
    }
    const snapshot = (0, layeringModes_1.parseLayeringPlanSnapshot)(raw);
    if (snapshot == null)
        return { ok: false, reason: 'malformed_metadata' };
    if (snapshot.mode !== 'static' && snapshot.mode !== 'dynamic')
        return { ok: false, reason: 'unsupported_version' };
    if (snapshot.schemaVersion !== layeringModes_1.LAYERING_PLAN_SCHEMA_VERSION || snapshot.calculatorVersion !== layeringModes_1.LAYERING_PLAN_CALCULATOR_VERSION) {
        return { ok: false, reason: 'unsupported_version' };
    }
    return { ok: true, outcome: 'recovered', snapshot };
}
function normalizeStatus(value) {
    return value === 'prepared' || value === 'activating' || value === 'active'
        || value === 'entries_complete' || value === 'completed'
        || value === 'cancelling' || value === 'cancellation_pending' || value === 'cancellation_manual_review'
        || value === 'cancelled' || value === 'invalid'
        ? value
        : null;
}
function checkPlanRowStatus(status) {
    if (status === 'prepared' || status === 'activating' || status === 'active')
        return null;
    if (status === 'invalid')
        return 'invalid_plan';
    return 'terminal_plan';
}
function parsePersistedLayeringPlanRow(row) {
    if (row == null || typeof row !== 'object' || Array.isArray(row))
        return { ok: false, reason: 'malformed_existing_plan' };
    const data = row;
    const status = normalizeStatus(data.status);
    if (status == null)
        return { ok: false, reason: 'unknown_status' };
    const statusReason = checkPlanRowStatus(status);
    if (statusReason != null)
        return { ok: false, reason: statusReason };
    const parsed = parsePersistedLayeringPlan(data.layer_plan_metadata);
    if (!parsed.ok)
        return parsed.reason === 'malformed_metadata' ? { ok: false, reason: 'malformed_existing_plan' } : parsed;
    const snapshot = parsed.snapshot;
    if (data.layer_plan_id !== snapshot.planId
        || data.signal_id !== snapshot.signalId
        || data.broker_account_id !== snapshot.brokerAccountId
        || data.basket_key !== (snapshot.basketKey ?? '')
        || data.mode !== snapshot.mode)
        return { ok: false, reason: 'identity_mismatch' };
    if (data.created_at !== snapshot.createdAt || data.locked_at !== snapshot.lockedAt) {
        return { ok: false, reason: 'identity_mismatch' };
    }
    if (data.semantic_fingerprint != null && data.semantic_fingerprint !== computeLayeringPlanFingerprint(snapshot)) {
        return { ok: false, reason: 'identity_mismatch' };
    }
    return parsed;
}
function snapshotMetadata(snapshot) {
    return (0, layeringModes_1.serializeLayeringPlanSnapshot)(snapshot);
}
function isDuplicateError(error) {
    if (error == null || typeof error !== 'object')
        return false;
    const e = error;
    return e.code === '23505' || /duplicate key|unique constraint/i.test(e.message ?? '');
}
function isAmbiguousPersistenceError(error) {
    if (error == null || typeof error !== 'object')
        return false;
    const e = error;
    return /timeout|timed out|connection.*closed|network|fetch failed/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
}
async function loadLayeringPlan(supabase, planId) {
    if (!(0, layeringModes_1.isValidLayerPlanId)(planId))
        return { ok: false, reason: 'invalid_plan_id' };
    const { data, error } = await supabase
        .from('layering_plans')
        .select('layer_plan_id,signal_id,broker_account_id,basket_key,mode,status,layer_plan_metadata,semantic_fingerprint,created_at,locked_at')
        .eq('layer_plan_id', planId)
        .maybeSingle();
    if (error)
        return { ok: false, reason: 'persistence_failed' };
    if (!data)
        return { ok: false, reason: 'not_found' };
    return parsePersistedLayeringPlanRow(data);
}
async function persistLayeringPlan(supabase, snapshot) {
    const parsed = parsePersistedLayeringPlan(snapshot);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason };
    const metadata = snapshotMetadata(parsed.snapshot);
    if (metadata == null)
        return { ok: false, reason: 'invalid_snapshot' };
    const fingerprint = computeLayeringPlanFingerprint(parsed.snapshot);
    if (fingerprint == null)
        return { ok: false, reason: 'invalid_snapshot' };
    const { error } = await supabase.from('layering_plans').insert({
        layer_plan_id: parsed.snapshot.planId,
        signal_id: parsed.snapshot.signalId,
        broker_account_id: parsed.snapshot.brokerAccountId,
        basket_key: parsed.snapshot.basketKey ?? '',
        mode: parsed.snapshot.mode,
        status: 'prepared',
        layer_plan_metadata: metadata,
        semantic_fingerprint: fingerprint,
        created_at: parsed.snapshot.createdAt,
        locked_at: parsed.snapshot.lockedAt,
    });
    if (!error)
        return { ok: true, outcome: 'created', snapshot: parsed.snapshot };
    if (!isDuplicateError(error) && !isAmbiguousPersistenceError(error))
        return { ok: false, reason: 'persistence_failed' };
    const afterDuplicate = await loadLayeringPlan(supabase, snapshot.planId);
    if (!afterDuplicate.ok)
        return { ok: false, reason: afterDuplicate.reason === 'not_found' ? 'persistence_failed' : afterDuplicate.reason };
    return snapshotsMatch(afterDuplicate.snapshot, parsed.snapshot)
        ? { ok: true, outcome: 'already_exists_matching', snapshot: afterDuplicate.snapshot }
        : { ok: false, reason: 'conflict' };
}
async function claimLayeringPlanActivation(supabase, snapshot) {
    const parsed = parsePersistedLayeringPlan(snapshot);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason };
    const fingerprint = computeLayeringPlanFingerprint(parsed.snapshot);
    if (fingerprint == null)
        return { ok: false, reason: 'invalid_snapshot' };
    const { data, error } = await supabase
        .from('layering_plans')
        .update({ status: 'activating', updated_at: new Date().toISOString(), activated_at: new Date().toISOString() })
        .eq('layer_plan_id', parsed.snapshot.planId)
        .eq('status', 'prepared')
        .eq('semantic_fingerprint', fingerprint)
        .select('layer_plan_id')
        .maybeSingle();
    if (!error && data)
        return { ok: true, outcome: 'activation_claimed' };
    const existing = await loadLayeringPlan(supabase, parsed.snapshot.planId);
    if (!existing.ok)
        return { ok: false, reason: existing.reason };
    if (!snapshotsMatch(existing.snapshot, parsed.snapshot))
        return { ok: false, reason: 'fingerprint_conflict' };
    const row = await supabase
        .from('layering_plans')
        .select('status')
        .eq('layer_plan_id', parsed.snapshot.planId)
        .maybeSingle();
    const status = normalizeStatus(row.data?.status);
    if (status === 'active')
        return { ok: true, outcome: 'already_active' };
    if (status === 'activating')
        return { ok: false, reason: 'already_activating' };
    if (status === 'entries_complete' || status === 'completed' || status === 'cancelling' || status === 'cancellation_pending' || status === 'cancellation_manual_review' || status === 'cancelled')
        return { ok: false, reason: 'terminal_plan' };
    if (status === 'invalid')
        return { ok: false, reason: 'invalid_plan' };
    return { ok: false, reason: 'activation_failed' };
}
async function activateLayeringPlanWithLegs(supabase, snapshot, args) {
    const parsed = parsePersistedLayeringPlan(snapshot);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason };
    const fingerprint = computeLayeringPlanFingerprint(parsed.snapshot);
    if (fingerprint == null)
        return { ok: false, reason: 'invalid_snapshot' };
    const legacyRows = Array.isArray(args) ? args : null;
    const activationArgs = args;
    const firstLegacy = legacyRows?.[0];
    const legContext = legacyRows
        ? {
            user_id: firstLegacy?.user_id ?? '',
            signal_id: parsed.snapshot.signalId,
            broker_account_id: parsed.snapshot.brokerAccountId,
            metaapi_account_id: firstLegacy?.metaapi_account_id ?? '',
            stoploss: firstLegacy?.stoploss ?? null,
            takeprofit: firstLegacy?.takeprofit ?? null,
            slippage: firstLegacy?.slippage ?? 20,
            comment: firstLegacy?.comment ?? null,
            expert_id: firstLegacy?.expert_id ?? null,
            expires_at: firstLegacy?.expires_at ?? null,
            cwe_close_price: firstLegacy?.cwe_close_price ?? null,
            broker_pending_type: firstLegacy?.broker_pending_type ?? null,
        }
        : activationArgs.legContext;
    const executionMechanism = legacyRows
        ? (firstLegacy?.status === 'broker_pending' ? 'pending_order' : 'auto')
        : activationArgs.executionMechanism;
    const excludeFirstLayer = legacyRows ? firstLegacy?.step_idx === 2 : activationArgs.excludeFirstLayer;
    const { data, error } = await supabase.rpc('activate_layering_plan', {
        p_layer_plan_id: parsed.snapshot.planId,
        p_semantic_fingerprint: fingerprint,
        p_execution_mechanism: executionMechanism,
        p_exclude_first_layer: excludeFirstLayer,
        p_leg_context: legContext,
    });
    if (error)
        return { ok: false, reason: 'activation_failed' };
    const outcome = typeof data === 'string'
        ? data
        : (data && typeof data === 'object' ? String(data.outcome ?? '') : '');
    if (outcome === 'activated')
        return { ok: true, outcome: 'activated' };
    if (outcome === 'already_active')
        return { ok: true, outcome: 'already_active' };
    if (outcome === 'already_activating')
        return { ok: false, reason: 'already_activating' };
    if (outcome === 'fingerprint_conflict')
        return { ok: false, reason: 'fingerprint_conflict' };
    if (outcome === 'terminal_plan')
        return { ok: false, reason: 'terminal_plan' };
    if (outcome === 'not_found')
        return { ok: false, reason: 'not_found' };
    return { ok: false, reason: 'activation_failed' };
}
function materializeLayerPlanLegRows(snapshot) {
    const parsed = parsePersistedLayeringPlan(snapshot);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason };
    const metadata = snapshotMetadata(parsed.snapshot);
    if (metadata == null || parsed.snapshot.fundedPrices == null || parsed.snapshot.lots == null) {
        return { ok: false, reason: 'invalid_snapshot' };
    }
    const rows = parsed.snapshot.fundedPrices.map((price, idx) => ({
        layer_plan_id: parsed.snapshot.planId,
        layer_plan_metadata: metadata,
        signal_id: parsed.snapshot.signalId,
        broker_account_id: parsed.snapshot.brokerAccountId,
        symbol: parsed.snapshot.symbol,
        step_idx: idx + 1,
        is_buy: parsed.snapshot.side === 'buy',
        trigger_price: price,
        volume: parsed.snapshot.lots[idx],
        status: 'planned',
    }));
    return { ok: true, rows: Object.freeze(rows) };
}
function materializeExecutableLayerPlanLegRows(args) {
    const parsed = parsePersistedLayeringPlan(args.snapshot);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason };
    const metadata = snapshotMetadata(parsed.snapshot);
    if (metadata == null || parsed.snapshot.fundedPrices == null || parsed.snapshot.lots == null) {
        return { ok: false, reason: 'invalid_snapshot' };
    }
    const start = args.skipFirstLayer ? 1 : 0;
    const anchor = parsed.snapshot.executableAnchorPrice ?? parsed.snapshot.fundedPrices[0] ?? parsed.snapshot.anchorPrice;
    if (anchor == null || !Number.isFinite(anchor) || anchor <= 0)
        return { ok: false, reason: 'invalid_snapshot' };
    const rows = parsed.snapshot.fundedPrices.slice(start).map((price, offset) => {
        const idx = start + offset;
        return {
            layer_plan_id: parsed.snapshot.planId,
            layer_plan_metadata: metadata,
            signal_id: parsed.snapshot.signalId,
            user_id: args.userId,
            broker_account_id: parsed.snapshot.brokerAccountId,
            metaapi_account_id: args.metaapiAccountId,
            symbol: parsed.snapshot.symbol,
            step_idx: idx + 1,
            is_buy: parsed.snapshot.side === 'buy',
            volume: parsed.snapshot.lots[idx],
            anchor_price: anchor,
            trigger_price: price,
            stoploss: args.stoploss,
            takeprofit: args.cweClosePrice != null ? null : args.takeprofit,
            slippage: args.slippage,
            comment: args.comment,
            expert_id: args.expertId ?? null,
            expires_at: args.expiresAt ?? null,
            status: args.status,
            cwe_close_price: args.cweClosePrice ?? null,
        };
    });
    return { ok: true, rows: Object.freeze(rows) };
}
function recoverLayeringPlan(args) {
    if (!args.planRow)
        return { ok: false, reason: 'not_found' };
    const parsed = 'layer_plan_id' in args.planRow
        ? parsePersistedLayeringPlanRow(args.planRow)
        : (() => {
            const status = args.planRow.status == null ? null : normalizeStatus(args.planRow.status);
            if (args.planRow.status != null && status == null)
                return { ok: false, reason: 'unknown_status' };
            if (status != null) {
                const statusReason = checkPlanRowStatus(status);
                if (statusReason != null)
                    return { ok: false, reason: statusReason };
            }
            return parsePersistedLayeringPlan(args.planRow.layer_plan_metadata);
        })();
    if (!parsed.ok)
        return parsed;
    if (args.legRows != null && args.legRows.length > 0) {
        const expected = materializeLayerPlanLegRows(parsed.snapshot);
        if (!expected.ok)
            return { ok: false, reason: expected.reason };
        if (args.legRows.length !== expected.rows.length)
            return { ok: false, reason: 'leg_count_mismatch' };
        const seen = new Set();
        for (const row of args.legRows) {
            const idx = Number(row.step_idx);
            if (!Number.isInteger(idx) || idx < 1 || idx > expected.rows.length)
                return { ok: false, reason: 'identity_mismatch' };
            if (seen.has(idx))
                return { ok: false, reason: 'duplicate_leg' };
            seen.add(idx);
            const want = expected.rows[idx - 1];
            if (row.layer_plan_id !== want.layer_plan_id || row.signal_id !== want.signal_id || row.broker_account_id !== want.broker_account_id) {
                return { ok: false, reason: 'identity_mismatch' };
            }
            if (row.status != null && row.status !== want.status)
                return { ok: false, reason: 'identity_mismatch' };
            if (row.trigger_price !== want.trigger_price)
                return { ok: false, reason: 'price_mismatch' };
            if (row.volume !== want.volume)
                return { ok: false, reason: 'lot_mismatch' };
        }
    }
    return parsed;
}
