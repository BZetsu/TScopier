"use strict";
/**
 * Worker process role and shard configuration (Railway / multi-service deploy).
 *
 * WORKER_ROLE:
 *   all      — monolith (default): listener + trade monitors + backtest HTTP
 *   listener — Telegram ingest only; no trade monitors; backtest HTTP returns 503
 *   trade    — TradeExecutor + monitors; no Telegram listeners
 *   backtest — Ephemeral Telegram client for backtest sync only; no live listener
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerConfig = void 0;
exports.shardForUserId = shardForUserId;
exports.userBelongsToShard = userBelongsToShard;
exports.listenerWorkerId = listenerWorkerId;
exports.leaseRoleLabel = leaseRoleLabel;
function parseRole(raw) {
    const v = String(raw ?? 'all').toLowerCase().trim();
    if (v === 'listener' || v === 'trade' || v === 'backtest')
        return v;
    return 'all';
}
const role = parseRole(process.env.WORKER_ROLE);
exports.workerConfig = {
    role,
    instanceId: String(process.env.WORKER_INSTANCE_ID
        ?? `${process.env.HOSTNAME ?? 'local'}:${process.pid}`),
    shardId: Math.max(0, Math.floor(Number(process.env.WORKER_SHARD_ID ?? 0))),
    shardCount: Math.max(1, Math.floor(Number(process.env.WORKER_SHARD_COUNT ?? 1))),
    runsListener: role === 'all' || role === 'listener',
    runsTrade: role === 'all' || role === 'trade',
    runsBacktestHttp: role === 'all' || role === 'backtest',
    /** Backtest uses a short-lived Telegram client, never the live listener connection. */
    backtestUsesEphemeralClient: role !== 'all' || process.env.BACKTEST_EPHEMERAL_CLIENT !== 'false',
};
function shardForUserId(userId, shardCount) {
    let h = 0;
    for (let i = 0; i < userId.length; i++) {
        h = (h * 31 + userId.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % Math.max(1, shardCount);
}
function userBelongsToShard(userId) {
    if (exports.workerConfig.shardCount <= 1)
        return true;
    return shardForUserId(userId, exports.workerConfig.shardCount) === exports.workerConfig.shardId;
}
function listenerWorkerId() {
    return `listener:${exports.workerConfig.shardId}:${exports.workerConfig.instanceId}`;
}
function leaseRoleLabel() {
    if (exports.workerConfig.role === 'listener')
        return 'listener';
    if (exports.workerConfig.role === 'all')
        return 'listener';
    return exports.workerConfig.role;
}
