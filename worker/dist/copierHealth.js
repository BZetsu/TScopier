"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copierHealthOfflineGraceMs = copierHealthOfflineGraceMs;
exports.copierHealthFreshnessThresholdMs = copierHealthFreshnessThresholdMs;
exports.resolveCopierEngineState = resolveCopierEngineState;
exports.persistCopierHealth = persistCopierHealth;
exports.maybeCaptureCopierOffline = maybeCaptureCopierOffline;
exports.resetCopierHealthForTests = resetCopierHealthForTests;
const workerConfig_1 = require("./workerConfig");
const businessEvents_1 = require("./observability/businessEvents");
const WRITE_MIN_MS = 30000;
const OFFLINE_GRACE_DEFAULT_MS = 60000;
const PROBE_INTERVAL_MS = 30000;
const MAX_CLOCK_SKEW_MS = 5 * 60000;
const lastWrites = new Map();
const offlineNotified = new Map();
function copierHealthOfflineGraceMs() {
    const n = Number(process.env.COPIER_HEALTH_OFFLINE_GRACE_MS);
    if (!Number.isFinite(n) || n < 0)
        return OFFLINE_GRACE_DEFAULT_MS;
    return Math.min(10 * 60000, Math.floor(n));
}
function copierHealthFreshnessThresholdMs() {
    return Math.max(copierHealthOfflineGraceMs(), PROBE_INTERVAL_MS * 3);
}
function validPastTimestamp(value, nowMs) {
    if (value == null || !Number.isFinite(value))
        return null;
    if (value > nowMs + MAX_CLOCK_SKEW_MS)
        return null;
    return value;
}
function resolveCopierEngineState(args) {
    const now = args.nowMs ?? Date.now();
    const grace = args.offlineGraceMs ?? copierHealthOfflineGraceMs();
    const freshness = args.freshnessThresholdMs ?? copierHealthFreshnessThresholdMs();
    if (args.copierPaused) {
        return {
            telegramAccountStatus: args.linked ? 'linked' : 'not_linked',
            workerOwnershipStatus: args.owned ? 'owned' : 'unowned',
            copierEngineStatus: 'stopped',
            healthReason: 'copier_paused',
        };
    }
    if (!args.linked) {
        return {
            telegramAccountStatus: 'not_linked',
            workerOwnershipStatus: args.owned ? 'owned' : 'unowned',
            copierEngineStatus: 'stopped',
            healthReason: 'telegram_not_linked',
        };
    }
    if (args.sessionActive === false || args.recoveryExhausted) {
        return {
            telegramAccountStatus: 'reconnect_required',
            workerOwnershipStatus: args.owned ? 'owned' : 'unowned',
            copierEngineStatus: 'stopped',
            healthReason: args.recoveryExhausted ? 'recovery_exhausted' : 'telegram_session_inactive',
        };
    }
    if (!args.owned) {
        return {
            telegramAccountStatus: 'linked',
            workerOwnershipStatus: 'unowned',
            copierEngineStatus: 'offline',
            healthReason: 'listener_not_owned',
        };
    }
    if (args.shutdownInProgress) {
        return {
            telegramAccountStatus: 'linked',
            workerOwnershipStatus: 'owned',
            copierEngineStatus: 'stopped',
            healthReason: 'worker_shutdown',
        };
    }
    const lastOk = validPastTimestamp(args.lastSuccessfulProbeAt ?? null, now);
    const ageMs = lastOk == null ? null : now - lastOk;
    const probeFresh = ageMs != null && ageMs <= freshness;
    if (args.listenerStatus === 'connected' && args.mtprotoConnected === true && probeFresh) {
        return {
            telegramAccountStatus: 'linked',
            workerOwnershipStatus: 'owned',
            copierEngineStatus: 'operational',
            healthReason: 'listener_connected',
        };
    }
    const withinGrace = ageMs != null && ageMs <= grace;
    const connectedButRecoverable = args.listenerStatus === 'connected'
        && (ageMs == null || ageMs <= freshness + grace);
    if (connectedButRecoverable || args.listenerStatus === 'reconnecting' || withinGrace) {
        return {
            telegramAccountStatus: 'linked',
            workerOwnershipStatus: 'owned',
            copierEngineStatus: 'degraded',
            healthReason: args.listenerStatus === 'connected' ? 'probe_stale' : 'listener_reconnecting',
        };
    }
    return {
        telegramAccountStatus: 'linked',
        workerOwnershipStatus: 'owned',
        copierEngineStatus: 'offline',
        healthReason: 'listener_disconnected',
    };
}
function signature(patch) {
    return JSON.stringify({
        a: patch.telegramAccountStatus,
        l: patch.listenerStatus,
        e: patch.copierEngineStatus,
        o: patch.workerOwnershipStatus,
        m: patch.mtprotoConnected,
        f: patch.consecutiveProbeFailures,
        r: patch.reconnectAttempt,
        x: patch.recoveryExhausted,
        s: patch.shutdownInProgress,
        h: patch.healthReason,
        p: patch.freshnessThresholdMs,
        g: patch.ownershipEpoch,
    });
}
async function persistCopierHealth(supabase, userId, patch, opts) {
    try {
        const nowMs = opts?.nowMs ?? Date.now();
        const ownershipEpoch = opts?.ownershipEpoch ?? patch.ownershipEpoch ?? null;
        const leaseAcquiredAt = opts?.leaseAcquiredAt ?? patch.leaseAcquiredAt ?? null;
        const freshnessThresholdMs = patch.freshnessThresholdMs ?? copierHealthFreshnessThresholdMs();
        const enrichedPatch = { ...patch, ownershipEpoch, leaseAcquiredAt, freshnessThresholdMs };
        const sig = signature(enrichedPatch);
        const prev = lastWrites.get(userId);
        if (!opts?.force && prev?.signature === sig && nowMs - prev.at < WRITE_MIN_MS)
            return 'skipped';
        lastWrites.set(userId, { at: nowMs, signature: sig });
        const requireLease = opts?.allowWithoutLease !== true && patch.workerOwnershipStatus === 'owned';
        const { data, error } = await supabase.rpc('upsert_copier_listener_health', {
            p_user_id: userId,
            p_expected_worker_id: (0, workerConfig_1.listenerWorkerId)(),
            p_ownership_epoch: ownershipEpoch,
            p_require_lease: requireLease,
            p_allow_without_lease: opts?.allowWithoutLease === true,
            p_role: workerConfig_1.workerConfig.role,
            p_shard_id: workerConfig_1.workerConfig.shardId,
            p_shard_count: workerConfig_1.workerConfig.shardCount,
            p_telegram_account_status: patch.telegramAccountStatus,
            p_listener_status: patch.listenerStatus,
            p_copier_engine_status: patch.copierEngineStatus,
            p_worker_ownership_status: patch.workerOwnershipStatus,
            p_mtproto_connected: patch.mtprotoConnected,
            p_last_connected_at: patch.lastConnectedAt,
            p_last_disconnected_at: patch.lastDisconnectedAt,
            p_last_probe_at: patch.lastProbeAt,
            p_last_successful_probe_at: patch.lastSuccessfulProbeAt,
            p_consecutive_probe_failures: patch.consecutiveProbeFailures,
            p_reconnect_started_at: patch.reconnectStartedAt,
            p_reconnect_attempt: patch.reconnectAttempt,
            p_recovery_exhausted: patch.recoveryExhausted,
            p_shutdown_in_progress: patch.shutdownInProgress,
            p_health_reason: patch.healthReason,
            p_freshness_threshold_ms: freshnessThresholdMs,
            p_lease_acquired_at: leaseAcquiredAt,
            p_updated_at: new Date(nowMs).toISOString(),
        });
        if (error)
            throw new Error(error.message);
        if (data !== true) {
            (0, businessEvents_1.addBusinessBreadcrumb)({
                category: 'copier',
                event: 'listener_health_stale',
                level: 'warning',
                context: {
                    user_id: userId,
                    operation: 'copier_health_persist',
                    extra: {
                        reason: 'stale_ownership_rejected',
                        listener_status: patch.listenerStatus,
                        worker_ownership_status: patch.workerOwnershipStatus,
                    },
                },
            });
            return 'stale_ownership';
        }
        return 'written';
    }
    catch {
        // Health persistence is diagnostic only; never stop Telegram/trading.
        return 'error';
    }
}
function maybeCaptureCopierOffline(args) {
    try {
        const now = Date.now();
        if (!args.manualReview && args.sinceMs != null && now - args.sinceMs < copierHealthOfflineGraceMs())
            return;
        const key = `${args.reasonCode}|${args.reason}`;
        const until = offlineNotified.get(key) ?? 0;
        if (!args.manualReview && until > now)
            return;
        offlineNotified.set(key, now + 5 * 60000);
        (0, businessEvents_1.captureBusinessIssue)({
            category: 'copier',
            event: args.listenerStatus === 'failed' ? 'telegram_listener_failed' : 'copier_engine_offline',
            severity: 'error',
            reasonCode: args.reasonCode,
            message: 'Copier listener health is user-impacting',
            userImpact: args.manualReview ? 'manual_review_required' : 'failed',
            fingerprint: ['copier_health', args.reasonCode, args.listenerStatus],
            context: {
                user_id: args.userId,
                operation: 'copier_health',
                extra: {
                    listener_status: args.listenerStatus,
                    reason: args.reason,
                    offline_grace_ms: copierHealthOfflineGraceMs(),
                },
            },
        });
    }
    catch {
        // best-effort only
    }
}
function resetCopierHealthForTests() {
    lastWrites.clear();
    offlineNotified.clear();
}
