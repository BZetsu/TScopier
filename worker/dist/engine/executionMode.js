"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.v2EngineConfigured = v2EngineConfigured;
exports.resolveExecutionEngine = resolveExecutionEngine;
exports.isV2 = isV2;
exports.splitBrokersByEngine = splitBrokersByEngine;
function parseIds(raw) {
    if (!raw)
        return new Set();
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}
/** True when any v2 routing is configured at all - used to avoid starting the v2
 * reconcile loop (and its per-tick trades scan) when nobody is on v2. */
function v2EngineConfigured(env = process.env) {
    if ((env.EXECUTION_ENGINE ?? '').trim().toLowerCase() === 'v2')
        return true;
    if (parseIds(env.EXECUTION_ENGINE_V2_BROKERS).size > 0)
        return true;
    if (parseIds(env.EXECUTION_ENGINE_V2_USERS).size > 0)
        return true;
    return false;
}
function resolveExecutionEngine(args, env = process.env) {
    if ((env.EXECUTION_ENGINE ?? '').trim().toLowerCase() === 'v2')
        return 'v2';
    const brokers = parseIds(env.EXECUTION_ENGINE_V2_BROKERS);
    if (args.brokerAccountId && brokers.has(args.brokerAccountId))
        return 'v2';
    const users = parseIds(env.EXECUTION_ENGINE_V2_USERS);
    if (args.userId && users.has(args.userId))
        return 'v2';
    return 'v1';
}
function isV2(args, env) {
    return resolveExecutionEngine(args, env) === 'v2';
}
/**
 * Partition a signal's matching brokers into v1 vs v2 lanes so the two engines can
 * run side by side during cutover. With the flag off every broker lands in `v1` and
 * behavior is byte-for-byte unchanged.
 */
function splitBrokersByEngine(brokers, env) {
    const v1 = [];
    const v2 = [];
    for (const b of brokers) {
        if (isV2({ brokerAccountId: b.id, userId: b.user_id ?? null }, env))
            v2.push(b);
        else
            v1.push(b);
    }
    return { v1, v2 };
}
