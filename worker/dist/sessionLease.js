"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireSessionLease = acquireSessionLease;
exports.renewSessionLease = renewSessionLease;
exports.releaseSessionLease = releaseSessionLease;
exports.isTelegramListenerLiveForUser = isTelegramListenerLiveForUser;
exports.listActiveLeases = listActiveLeases;
const workerConfig_1 = require("./workerConfig");
const LEASE_TTL_MS = Math.max(15000, Math.min(120000, Number(process.env.WORKER_SESSION_LEASE_TTL_MS ?? 45000)));
function expiresAtIso() {
    return new Date(Date.now() + LEASE_TTL_MS).toISOString();
}
/**
 * Claim listener ownership for user_id. Fails if another worker holds a non-expired lease.
 */
async function acquireSessionLease(supabase, userId) {
    const workerId = (0, workerConfig_1.listenerWorkerId)();
    const now = new Date().toISOString();
    const { data: existing } = await supabase
        .from('worker_session_leases')
        .select('worker_id, expires_at')
        .eq('user_id', userId)
        .maybeSingle();
    if (existing) {
        const exp = new Date(existing.expires_at).getTime();
        const held = existing.worker_id;
        if (exp > Date.now() && held !== workerId) {
            return { ok: false, reason: `lease held by ${held} until ${existing.expires_at}` };
        }
    }
    const { error } = await supabase.from('worker_session_leases').upsert({
        user_id: userId,
        worker_id: workerId,
        role: (0, workerConfig_1.leaseRoleLabel)(),
        shard_id: workerConfig_1.workerConfig.shardId,
        shard_count: workerConfig_1.workerConfig.shardCount,
        expires_at: expiresAtIso(),
        updated_at: now,
    }, { onConflict: 'user_id' });
    if (error)
        return { ok: false, reason: error.message };
    return { ok: true };
}
async function renewSessionLease(supabase, userId) {
    const workerId = (0, workerConfig_1.listenerWorkerId)();
    await supabase
        .from('worker_session_leases')
        .update({
        worker_id: workerId,
        expires_at: expiresAtIso(),
        updated_at: new Date().toISOString(),
    })
        .eq('user_id', userId)
        .eq('worker_id', workerId);
}
async function releaseSessionLease(supabase, userId) {
    const workerId = (0, workerConfig_1.listenerWorkerId)();
    await supabase
        .from('worker_session_leases')
        .delete()
        .eq('user_id', userId)
        .eq('worker_id', workerId);
}
/** Trade workers: true when a listener shard holds a fresh lease (Telegram path is live). */
async function isTelegramListenerLiveForUser(supabase, userId) {
    const { data } = await supabase
        .from('worker_session_leases')
        .select('expires_at, role')
        .eq('user_id', userId)
        .maybeSingle();
    if (!data)
        return false;
    const role = String(data.role ?? '');
    if (role !== 'listener' && role !== 'all')
        return false;
    return new Date(data.expires_at).getTime() > Date.now();
}
async function listActiveLeases(supabase) {
    const { data } = await supabase
        .from('worker_session_leases')
        .select('*')
        .gt('expires_at', new Date().toISOString());
    return (data ?? []);
}
