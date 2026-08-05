"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserSessionManager = exports.TelegramSessionInvalidError = void 0;
const backtestSync_1 = require("./backtestSync");
const telegramClient_1 = require("./telegramClient");
Object.defineProperty(exports, "TelegramSessionInvalidError", { enumerable: true, get: function () { return telegramClient_1.TelegramSessionInvalidError; } });
const userListener_1 = require("./userListener");
const sessionLease_1 = require("./sessionLease");
const workerMetrics_1 = require("./workerMetrics");
const workerConfig_1 = require("./workerConfig");
const parallelPool_1 = require("./parallelPool");
const tradeSignalActions_1 = require("./tradeSignalActions");
const channelListenerManager_1 = require("./channelListenerManager");
const channelReconcileMonitor_1 = require("./channelReconcileMonitor");
const channelFeedGate_1 = require("./channelFeedGate");
const channelListenerConfig_1 = require("./channelListenerConfig");
const subscriptionAccess_1 = require("./subscriptionAccess");
const authKeyDuplicatedRecovery_1 = require("./authKeyDuplicatedRecovery");
const sentry_1 = require("./observability/sentry");
/**
 * Race a promise against a timeout so a single wedged network call cannot
 * stall a whole loop forever. Does not cancel the underlying work (the
 * caller just stops waiting), which is enough to keep periodic loops alive.
 */
async function withTimeout(p, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref?.();
    });
    try {
        return await Promise.race([p, timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function listenerInProcessDispatch(executor, row) {
    return executor.acceptDispatchSignal(row, {
        priority: (0, tradeSignalActions_1.dispatchPriorityForAction)((0, tradeSignalActions_1.parsedAction)(row.parsed_data)),
        source: row.dispatch_source ?? 'in_process',
    });
}
function gramjsListenerEnabled() {
    const engine = String(process.env.LISTENER_ENGINE ?? 'gramjs').toLowerCase().trim();
    return engine !== 'telethon';
}
function shouldRunGramjsForSession(session) {
    if (!gramjsListenerEnabled())
        return false;
    const engine = String(session.listener_engine ?? 'gramjs').toLowerCase().trim();
    return engine !== 'telethon';
}
/** Wait after disconnect so Telegram releases the auth key before a new connect. */
function authKeyReleaseDelayMs() {
    return Math.max(500, Math.min(120000, Number(process.env.TELEGRAM_RECONNECT_COOLDOWN_MS ?? 3500)));
}
function listenerStartTimeoutMs() {
    return Math.max(15000, Math.min(180000, Number(process.env.LISTENER_START_TIMEOUT_MS ?? 60000)));
}
/** Consecutive renew ticks with MTProto down before hard-resetting the Map entry. */
function disconnectedRenewHealTicks() {
    return Math.max(2, Math.min(20, Number(process.env.LISTENER_DISCONNECT_HEAL_TICKS ?? 3)));
}
class UserSessionManager {
    constructor(supabase) {
        this.listeners = new Map();
        this.channelChannel = null;
        this.authPendingChannel = null;
        this.realtimeHealthTimer = null;
        this.tradeExecutor = null;
        /** Serializes start/stop/adopt for one user — prevents AUTH_KEY_DUPLICATED races. */
        this.userConnectionLocks = new Map();
        /** True while adoptClient is handing off the auth-time MTProto socket. */
        this.adoptingUsers = new Set();
        this.authGuard = null;
        /** Guards renewAllLeases so slow cycles cannot stack up and exhaust sockets. */
        this.renewLeasesInFlight = false;
        /** Renew ticks spent disconnected; cleared when connected again. */
        this.disconnectedRenewTicks = new Map();
        this.channelListenerManager = null;
        this.channelReconcileMonitor = null;
        this.shuttingDown = false;
        /** Tracks start failures with timestamps so syncSessions doesn't retry in a tight loop. */
        this.recentlyFailed = new Map();
        this.supabase = supabase;
        this.channelListenerManager = new channelListenerManager_1.ChannelListenerManager(supabase);
        this.channelReconcileMonitor = new channelReconcileMonitor_1.ChannelReconcileMonitor(supabase, async (readerUserId, signalChannelId, telegramChatId) => {
            const listener = this.listeners.get(readerUserId);
            if (!listener?.isTelegramConnected())
                return null;
            const row = {
                id: '',
                channel_id: telegramChatId,
                channel_username: '',
                signal_channel_id: signalChannelId,
                last_seen_message_id: null,
            };
            return {
                client: listener.getClient(),
                resolvePeer: () => listener.resolveChannelPeerForReconcile(row),
            };
        });
    }
    getListener(userId) {
        return this.listeners.get(userId);
    }
    async startChannelListenerServices() {
        if (!this.channelListenerManager)
            return;
        await this.channelListenerManager.startup();
        this.channelListenerManager.startPeriodicSync();
        this.channelReconcileMonitor?.start();
    }
    stopChannelListenerServices() {
        this.stopRealtimeHealthCheck();
        this.channelListenerManager?.stop();
        this.channelReconcileMonitor?.stop();
    }
    /** In-memory pending auth check (send_code → verify_code window on this process). */
    setAuthGuard(fn) {
        this.authGuard = fn;
    }
    async withConnectionLock(userId, fn) {
        const prev = this.userConnectionLocks.get(userId) ?? Promise.resolve();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const chain = prev.then(() => gate);
        this.userConnectionLocks.set(userId, chain);
        try {
            await prev;
            return await fn();
        }
        finally {
            release();
            if (this.userConnectionLocks.get(userId) === chain) {
                this.userConnectionLocks.delete(userId);
            }
        }
    }
    isAuthBlocked(userId) {
        return this.adoptingUsers.has(userId) || Boolean(this.authGuard?.(userId));
    }
    async hasActivePendingAuthInDb(userId) {
        const { data } = await this.supabase
            .from('telegram_auth_pending')
            .select('user_id')
            .eq('user_id', userId)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
        return Boolean(data);
    }
    async shouldSkipListenerStart(userId) {
        if (this.isAuthBlocked(userId))
            return true;
        if (await this.hasActivePendingAuthInDb(userId))
            return true;
        if (!(await (0, subscriptionAccess_1.userMayRunCopierListener)(this.supabase, userId)))
            return true;
        return false;
    }
    async listenerStartBlockReason(userId) {
        if (this.isAuthBlocked(userId))
            return 'Telegram auth is in progress. Finish linking, then try again.';
        if (await this.hasActivePendingAuthInDb(userId)) {
            return 'Telegram auth is in progress. Finish linking, then try again.';
        }
        if (!(await (0, subscriptionAccess_1.userMayRunCopierListener)(this.supabase, userId))) {
            return 'An active subscription is required to connect Telegram.';
        }
        return null;
    }
    /** Stop listener + release lease when subscription is no longer active. */
    async stopListenerIfCopierInactive(userId) {
        if (await (0, subscriptionAccess_1.userMayRunCopierListener)(this.supabase, userId))
            return;
        if (this.listeners.has(userId)) {
            console.log(`[sessionManager] stopping listener for ${userId}: subscription inactive`);
            await this.stopListener(userId);
        }
        else {
            await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
        }
    }
    getSupabase() {
        return this.supabase;
    }
    setTradeExecutor(executor) {
        this.tradeExecutor = executor;
        for (const listener of this.listeners.values()) {
            listener.setOnSignalParsed(executor ? row => listenerInProcessDispatch(executor, row) : null);
        }
    }
    async loadAll() {
        if (this.shuttingDown)
            return;
        if (!workerConfig_1.workerConfig.runsListener)
            return;
        if (!gramjsListenerEnabled()) {
            console.log('[sessionManager] LISTENER_ENGINE=telethon — gramjs listener disabled on this service');
            return;
        }
        const { data: sessions, error } = await this.supabase
            .from('telegram_sessions')
            .select('user_id, session_string, phone_number, listener_engine')
            .eq('is_active', true);
        if (error) {
            console.error('[sessionManager] Failed to load sessions:', error.message);
            return;
        }
        const owned = (sessions ?? []).filter(s => (0, workerConfig_1.userBelongsToShard)(s.user_id) && shouldRunGramjsForSession(s));
        console.log(`[sessionManager] Loading ${owned.length}/${sessions?.length ?? 0} sessions`
            + ` (shard ${workerConfig_1.workerConfig.shardId}/${workerConfig_1.workerConfig.shardCount})`);
        const staggerMs = Math.max(0, Math.min(30000, Number(process.env.TELEGRAM_MULTI_SESSION_STAGGER_MS ?? 600)));
        const startTimeoutMs = listenerStartTimeoutMs();
        let i = 0;
        for (const session of owned) {
            if (i++ > 0 && staggerMs > 0) {
                await new Promise(r => setTimeout(r, staggerMs));
            }
            try {
                // Bound each connect so one wedged listener (e.g. a hung Telegram
                // warm-up) cannot stall startup for every other session.
                await withTimeout(this.startListener(session.user_id, session.session_string), startTimeoutMs, `startListener ${session.user_id}`);
            }
            catch (err) {
                console.error(`[sessionManager] Failed to start listener for ${session.user_id}:`, err instanceof Error ? err.message : err);
            }
        }
        this.subscribeToChannelChanges();
        this.subscribeToAuthPendingChanges();
        this.startRealtimeHealthCheck();
    }
    async renewAllLeases() {
        if (this.shuttingDown)
            return;
        // A previous cycle is still running (a wedged Supabase call). Skip rather
        // than stacking overlapping runs that each re-hang and leak sockets — that
        // race froze every lease but the first listener, taking the engine offline.
        if (this.renewLeasesInFlight) {
            console.warn('[sessionManager] renewAllLeases skipped — previous cycle still running');
            return;
        }
        this.renewLeasesInFlight = true;
        try {
            const staleMs = Math.max(60000, Math.min(600000, Number(process.env.WORKER_HEALTH_STALE_MS ?? 180000)));
            const perUserTimeoutMs = Math.max(3000, Math.min(30000, Number(process.env.WORKER_LEASE_RENEW_TIMEOUT_MS ?? 8000)));
            const concurrency = Math.max(1, Math.min(16, Number(process.env.WORKER_LEASE_RENEW_CONCURRENCY ?? 6)));
            // Renew with bounded parallelism and a per-user timeout so a single slow
            // or wedged lease write cannot block renewal for every other listener.
            const entries = Array.from(this.listeners.entries());
            await (0, parallelPool_1.parallelMap)(entries, concurrency, async ([userId, listener]) => {
                if (!(await (0, subscriptionAccess_1.userMayRunCopierListener)(this.supabase, userId))) {
                    await this.stopListenerIfCopierInactive(userId);
                    return;
                }
                // Realtime can lag; also stop when auth / mtproto_hold appears in DB.
                if (await this.hasActivePendingAuthInDb(userId)) {
                    await this.stopListenerForPendingAuth(userId);
                    return;
                }
                if (!listener.isTelegramConnected()) {
                    // Dead Map entries used to skip renew forever (UI "Copier engine offline").
                    // Kick reconnect first; after several failed ticks, hard-reset so syncSessions
                    // can startListener cleanly (reconnect-only can leave No lease forever).
                    const ticks = (this.disconnectedRenewTicks.get(userId) ?? 0) + 1;
                    this.disconnectedRenewTicks.set(userId, ticks);
                    const healAfter = disconnectedRenewHealTicks();
                    if (ticks >= healAfter) {
                        console.warn(`[sessionManager] hard-reset disconnected listener user=${userId}`
                            + ` after ${ticks} renew ticks — syncSessions will restart`);
                        this.disconnectedRenewTicks.delete(userId);
                        await this.stopListener(userId);
                        return;
                    }
                    console.log(`[sessionManager] listener disconnected but renewing lease anyway`
                        + ` user=${userId} — kicking reconnect in background`);
                    listener.requestReconnectIfDisconnected('lease_renew_disconnected');
                }
                this.disconnectedRenewTicks.delete(userId);
                try {
                    const result = await withTimeout((0, sessionLease_1.ensureSessionLeaseFresh)(this.supabase, userId), perUserTimeoutMs, `lease renew ${userId}`);
                    if (!result.ok) {
                        console.warn(`[sessionManager] lease refresh failed ${userId}: ${result.reason}`);
                        return;
                    }
                    if (result.recovered && this.tradeExecutor) {
                        const { replaySignalsAfterListenerRecovery } = await Promise.resolve().then(() => __importStar(require('./listenerSignalReplay')));
                        void replaySignalsAfterListenerRecovery(this.tradeExecutor, userId);
                    }
                }
                catch (err) {
                    console.warn(`[sessionManager] lease refresh failed ${userId}:`, err instanceof Error ? err.message : err);
                    return;
                }
                if (!listener.isListenerHealthy(staleMs)) {
                    console.warn(`[sessionManager] listener quiet but lease renewed user=${userId}`
                        + ' (no Telegram events recently — normal for low-traffic channels)');
                }
            });
        }
        finally {
            this.renewLeasesInFlight = false;
        }
    }
    subscribeToChannelChanges() {
        if (this.channelChannel)
            return;
        this.channelChannel = this.supabase
            .channel('telegram_channels_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'telegram_channels' }, (payload) => {
            const userId = (payload.new?.user_id ?? payload.old?.user_id);
            if (!userId)
                return;
            if (!(0, workerConfig_1.userBelongsToShard)(userId))
                return;
            const listener = this.listeners.get(userId);
            if (!listener)
                return;
            listener.onChannelsChanged().catch(err => console.error(`[sessionManager] onChannelsChanged failed for ${userId}:`, err));
        })
            .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                console.log('[sessionManager] Realtime telegram_channels subscription active');
            }
            else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.warn(`[sessionManager] Realtime telegram_channels subscription ${status} — retrying in 5s`);
                this.channelChannel = null;
                setTimeout(() => this.subscribeToChannelChanges(), 5000);
            }
        });
    }
    subscribeToAuthPendingChanges() {
        if (this.authPendingChannel)
            return;
        this.authPendingChannel = this.supabase
            .channel('telegram_auth_pending_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'telegram_auth_pending' }, (payload) => {
            const userId = (payload.new?.user_id ?? payload.old?.user_id);
            if (!userId || !(0, workerConfig_1.userBelongsToShard)(userId))
                return;
            if (payload.eventType === 'DELETE') {
                void this.onAuthPendingCleared(userId);
                return;
            }
            void this.stopListenerForPendingAuth(userId);
        })
            .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                console.log('[sessionManager] Realtime telegram_auth_pending subscription active');
            }
            else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.warn(`[sessionManager] Realtime telegram_auth_pending subscription ${status} — retrying in 5s`);
                this.authPendingChannel = null;
                setTimeout(() => this.subscribeToAuthPendingChanges(), 5000);
            }
        });
    }
    startRealtimeHealthCheck() {
        this.stopRealtimeHealthCheck();
        this.realtimeHealthTimer = setInterval(() => {
            if (!this.channelChannel) {
                console.warn('[sessionManager] Health check: telegram_channels subscription missing — re-subscribing');
                this.subscribeToChannelChanges();
            }
            if (!this.authPendingChannel) {
                console.warn('[sessionManager] Health check: telegram_auth_pending subscription missing — re-subscribing');
                this.subscribeToAuthPendingChanges();
            }
        }, 60000);
    }
    stopRealtimeHealthCheck() {
        if (this.realtimeHealthTimer) {
            clearInterval(this.realtimeHealthTimer);
            this.realtimeHealthTimer = null;
        }
    }
    /**
     * Stop the live listener and wait until the session lease is gone before opening
     * a fresh MTProto client for phone/QR auth (avoids AUTH_KEY_DUPLICATED and
     * headless sessions eating login codes).
     */
    async prepareForAuth(userId) {
        if (this.shuttingDown) {
            throw new Error('Telegram worker is shutting down');
        }
        if (workerConfig_1.workerConfig.runsListener) {
            await this.withConnectionLock(userId, async () => {
                await this.disconnectListener(userId);
            });
        }
        await this.waitForListenerLeaseReleased(userId);
        const delay = authKeyReleaseDelayMs();
        if (delay > 0)
            await new Promise(r => setTimeout(r, delay));
    }
    /** Stop the live listener before send_code so the auth key slot is free on this host. */
    async pauseForAuth(userId, opts) {
        if (this.shuttingDown)
            return;
        if (!workerConfig_1.workerConfig.runsListener)
            return;
        await this.withConnectionLock(userId, async () => {
            await this.disconnectListener(userId);
            if (opts?.releaseDelay === false)
                return;
            const delay = authKeyReleaseDelayMs();
            if (delay > 0)
                await new Promise(r => setTimeout(r, delay));
        });
    }
    async stopListenerForPendingAuth(userId) {
        if (!this.listeners.has(userId))
            return;
        console.log(`[sessionManager] stopping listener for ${userId} — telegram auth / mtproto hold`);
        await this.withConnectionLock(userId, async () => {
            await this.disconnectListener(userId);
        });
    }
    /**
     * Ask the listener shard to release this user's MTProto slot (via telegram_auth_pending
     * Realtime + lease renew guard), then wait until the session lease is gone.
     */
    async acquireMtprotoHold(userId) {
        const { data: existing } = await this.supabase
            .from('telegram_auth_pending')
            .select('auth_method, expires_at')
            .eq('user_id', userId)
            .maybeSingle();
        if (existing
            && existing.auth_method
            && existing.auth_method !== 'mtproto_hold'
            && new Date(existing.expires_at).getTime() > Date.now()) {
            throw new Error('Telegram auth is in progress. Finish linking, then retry.');
        }
        const holdMs = Math.max(5 * 60000, Math.min(2 * 60 * 60000, Number(process.env.MTPROTO_HOLD_TTL_MS ?? 45 * 60000)));
        const expiresAt = new Date(Date.now() + holdMs).toISOString();
        const { error } = await this.supabase.from('telegram_auth_pending').upsert({
            user_id: userId,
            auth_method: 'mtproto_hold',
            phone: null,
            phone_code_hash: null,
            expires_at: expiresAt,
            awaiting_password: false,
            auth_session_string: null,
            qr_expires_at: null,
        }, { onConflict: 'user_id' });
        if (error) {
            console.error(`[sessionManager] mtproto_hold upsert failed for ${userId}:`, error.message);
            throw new Error('Could not pause live Telegram for this task. Try again in a minute.');
        }
        console.log(`[sessionManager] acquired mtproto_hold for ${userId}`);
        return true;
    }
    async releaseMtprotoHold(userId) {
        const { error } = await this.supabase
            .from('telegram_auth_pending')
            .delete()
            .eq('user_id', userId)
            .eq('auth_method', 'mtproto_hold');
        if (error) {
            console.warn(`[sessionManager] mtproto_hold release failed for ${userId}:`, error.message);
            return;
        }
        console.log(`[sessionManager] released mtproto_hold for ${userId}`);
    }
    /** Poll until the listener shard has dropped its session lease (or timeout). */
    async waitForListenerLeaseReleased(userId) {
        const timeoutMs = Math.max(10000, Math.min(120000, Number(process.env.MTPROTO_HOLD_WAIT_MS ?? 45000)));
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const { data } = await this.supabase
                .from('worker_session_leases')
                .select('expires_at, role')
                .eq('user_id', userId)
                .maybeSingle();
            if (!(0, sessionLease_1.isLeaseRowLive)(data)) {
                console.log(`[sessionManager] listener lease released for ${userId}`
                    + ` after ${Date.now() - started}ms`);
                return;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('Telegram is still connected on the live worker. Wait a minute and retry, or use Reconnect Telegram.');
    }
    async onAuthPendingCleared(userId) {
        // Debounce brief DELETE→upsert races (verify finalize, cancel). Auth start now
        // upserts in place so send_code no longer clears into an empty window.
        await new Promise(r => setTimeout(r, 2500));
        if (this.listeners.has(userId) || this.isAuthBlocked(userId))
            return;
        if (await this.hasActivePendingAuthInDb(userId))
            return;
        const { data: sess } = await this.supabase
            .from('telegram_sessions')
            .select('session_string, is_active, listener_engine')
            .eq('user_id', userId)
            .maybeSingle();
        if (!sess?.session_string || !sess.is_active || !shouldRunGramjsForSession(sess))
            return;
        try {
            await this.startListener(userId, sess.session_string);
        }
        catch (err) {
            console.warn(`[sessionManager] restart after auth cleared failed for ${userId}:`, err);
        }
    }
    async syncSessions() {
        if (!workerConfig_1.workerConfig.runsListener)
            return;
        const { data: sessions } = await this.supabase
            .from('telegram_sessions')
            .select('user_id, session_string, is_active, listener_engine');
        const activeOnShard = (sessions ?? []).filter(s => s.is_active && (0, workerConfig_1.userBelongsToShard)(s.user_id) && shouldRunGramjsForSession(s));
        const activeSessions = new Set(activeOnShard.map(s => s.user_id));
        for (const [userId] of this.listeners) {
            if (!activeSessions.has(userId) || await this.hasActivePendingAuthInDb(userId)) {
                await this.stopListener(userId);
            }
        }
        const cooldownMs = Math.max(30000, Math.min(3600000, Number(process.env.TELEGRAM_RETRY_COOLDOWN_MS ?? 300000)));
        const now = Date.now();
        for (const session of activeOnShard) {
            const userId = session.user_id;
            if (this.listeners.has(userId))
                continue;
            if (await this.shouldSkipListenerStart(userId))
                continue;
            const failedAt = this.recentlyFailed.get(userId);
            if (failedAt && now - failedAt < cooldownMs)
                continue;
            try {
                await withTimeout(this.startListener(userId, session.session_string), listenerStartTimeoutMs(), `syncSessions startListener ${userId}`);
                this.recentlyFailed.delete(userId);
            }
            catch (err) {
                this.recentlyFailed.set(userId, Date.now());
                console.error(`[sessionManager] Failed to start listener for ${userId}:`, err);
            }
        }
    }
    hasListener(userId) {
        return this.listeners.has(userId);
    }
    canExecuteTelegramCopierTrades(userId) {
        if (workerConfig_1.workerConfig.runsListener) {
            const listener = this.listeners.get(userId);
            if (listener?.isTelegramConnected())
                return true;
        }
        return false;
    }
    /** Async lease check for trade-only workers; canonical feed satisfies gate in primary mode. */
    async canExecuteTelegramCopierTradesAsync(userId, subscriptionChannelId) {
        if (subscriptionChannelId && (0, channelListenerConfig_1.channelListenerPrimaryMode)()) {
            const { data } = await this.supabase
                .from('telegram_channels')
                .select('signal_channel_id')
                .eq('id', subscriptionChannelId)
                .maybeSingle();
            const signalChannelId = data?.signal_channel_id;
            if (signalChannelId) {
                const feedLive = await (0, channelFeedGate_1.isChannelFeedLiveForSubscriber)(this.supabase, userId, signalChannelId);
                if (feedLive)
                    return true;
            }
        }
        if (workerConfig_1.workerConfig.runsListener) {
            return this.canExecuteTelegramCopierTrades(userId);
        }
        const { isTelegramListenerLiveForUser } = await Promise.resolve().then(() => __importStar(require('./sessionLease')));
        return isTelegramListenerLiveForUser(this.supabase, userId);
    }
    getStatus() {
        const out = [];
        for (const [, listener] of this.listeners) {
            out.push(listener.getStatus());
        }
        return out;
    }
    async getHealthPayload() {
        const status = this.getStatus();
        const now = Date.now();
        const staleMs = Math.max(60000, Math.min(600000, Number(process.env.WORKER_HEALTH_STALE_MS ?? 180000)));
        const connectedStatus = status.filter(s => s.connected);
        const listenerActivityOk = !workerConfig_1.workerConfig.runsListener
            || status.length === 0
            || status.every(s => s.connected && (s.last_event_at === 0 || now - s.last_event_at < staleMs));
        let freshLeasesForConnected = 0;
        let leaseMismatchUserIds = [];
        if (workerConfig_1.workerConfig.runsListener && connectedStatus.length > 0) {
            const leaseCheck = await (0, sessionLease_1.countFreshListenerLeasesForUsers)(this.supabase, connectedStatus.map(s => s.user_id));
            freshLeasesForConnected = leaseCheck.fresh;
            leaseMismatchUserIds = leaseCheck.missingUserIds;
        }
        const leaseGap = Math.max(0, connectedStatus.length - freshLeasesForConnected);
        const leaseMismatch = workerConfig_1.workerConfig.runsListener && leaseGap > 0;
        const leases = workerConfig_1.workerConfig.runsListener
            ? await (0, sessionLease_1.listActiveLeases)(this.supabase)
            : [];
        if (leaseMismatch) {
            console.warn(`[sessionManager] lease mismatch connected=${connectedStatus.length}`
                + ` fresh_leases=${freshLeasesForConnected} gap=${leaseGap}`
                + ` users=${leaseMismatchUserIds.join(',')}`);
        }
        return {
            ok: listenerActivityOk && !leaseMismatch,
            role: workerConfig_1.workerConfig.role,
            shard: `${workerConfig_1.workerConfig.shardId}/${workerConfig_1.workerConfig.shardCount}`,
            instance: workerConfig_1.workerConfig.instanceId,
            listeners: status.length,
            connected_listeners: connectedStatus.length,
            detail: status,
            active_leases: leases.length,
            fresh_leases_for_connected: freshLeasesForConnected,
            lease_mismatch: leaseMismatch,
            lease_gap: leaseGap,
            ...(leaseMismatchUserIds.length > 0
                ? { lease_mismatch_user_ids: leaseMismatchUserIds }
                : {}),
            metrics: (0, workerMetrics_1.getMetricsSnapshot)(),
            checked_at: new Date(now).toISOString(),
        };
    }
    async adoptClient(userId, client, sessionString) {
        if (this.shuttingDown) {
            throw new Error('Telegram worker is shutting down');
        }
        if (!workerConfig_1.workerConfig.runsListener) {
            throw new Error('Telegram listener not enabled on this worker (WORKER_ROLE)');
        }
        return this.withConnectionLock(userId, async () => {
            this.adoptingUsers.add(userId);
            try {
                await this.disconnectListener(userId);
                const lease = await (0, sessionLease_1.acquireSessionLease)(this.supabase, userId);
                if (!lease.ok) {
                    throw new Error(`Cannot adopt Telegram client: ${lease.reason}`);
                }
                const listener = new userListener_1.UserListener(userId, sessionString, this.supabase, client, (id, reason) => this.onAuthKeyDuplicatedRecoveryExhausted(id, reason));
                if (this.tradeExecutor) {
                    listener.setOnSignalParsed(row => listenerInProcessDispatch(this.tradeExecutor, row));
                }
                try {
                    await listener.start({ alreadyConnected: true });
                }
                catch (err) {
                    await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
                    throw err;
                }
                this.listeners.set(userId, listener);
                console.log(`[sessionManager] Adopted live client for user ${userId}`);
            }
            catch (err) {
                try {
                    await client.disconnect();
                }
                catch { /* ignore */ }
                throw err;
            }
            finally {
                this.adoptingUsers.delete(userId);
            }
        });
    }
    /** List channels on the listener adoptClient just registered — never opens a second MTProto socket. */
    async listChannelsForAdoptedUser(userId, opts) {
        const listener = this.listeners.get(userId);
        if (!listener)
            throw new Error('No listener after Telegram auth');
        return listener.listChannels(opts);
    }
    /**
     * Telegram revoked the auth key (AUTH_KEY_UNREGISTERED). Drop the dead session
     * so we stop reconnect loops, but keep configured telegram_channels — the user
     * reconnects manually without re-adding channels.
     */
    async invalidateTelegramSession(userId) {
        await this.stopListener(userId);
        await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
        await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId);
        const { error } = await this.supabase.from('telegram_sessions').delete().eq('user_id', userId);
        if (error) {
            console.warn(`[sessionManager] invalidateTelegramSession session delete failed for ${userId}:`, error.message);
        }
    }
    async listChannels(userId, opts) {
        const local = this.listeners.get(userId);
        if (local) {
            if (!local.isTelegramConnected()) {
                await local.ensureTelegramConnected('list_channels');
            }
            return local.listChannels(opts);
        }
        const listener = await this.ensureListener(userId);
        return listener.listChannels(opts);
    }
    /**
     * User-initiated recovery: stop + restart the live listener with the saved session
     * (does not require phone/QR). Used by Copier Engine "Reconnect Telegram".
     * On persistent failure, invalidates the session so the UI opens a fresh link flow
     * (same outcome as Disconnect-then-reconnect).
     */
    async reconnectTelegramSession(userId) {
        if (this.shuttingDown) {
            throw new Error('Telegram worker is shutting down');
        }
        if (!workerConfig_1.workerConfig.runsListener) {
            throw new Error('Live Telegram listener not available on this worker');
        }
        // Stale ephemeral holds block startListener; clear them on explicit reconnect.
        await this.supabase
            .from('telegram_auth_pending')
            .delete()
            .eq('user_id', userId)
            .eq('auth_method', 'mtproto_hold');
        if (await this.hasActivePendingAuthInDb(userId)) {
            throw new Error('Telegram auth is in progress. Finish linking, then try again.');
        }
        const { data: sess, error } = await this.supabase
            .from('telegram_sessions')
            .select('session_string, is_active')
            .eq('user_id', userId)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to load session: ${error.message}`);
        if (!sess?.session_string) {
            throw new telegramClient_1.TelegramSessionInvalidError('No Telegram session for this user');
        }
        if (!sess.is_active)
            throw new Error('Telegram session is paused');
        const sessionString = sess.session_string;
        const delays = (0, authKeyDuplicatedRecovery_1.authKeyDupReconnectDelaysMs)(authKeyReleaseDelayMs(), (0, authKeyDuplicatedRecovery_1.authKeyDupReconnectDelayMs)());
        let lastErr;
        for (let attempt = 0; attempt < delays.length; attempt++) {
            const delay = delays[attempt] ?? authKeyReleaseDelayMs();
            try {
                if (this.listeners.has(userId)) {
                    console.log(`[sessionManager] user reconnect: stopping listener for ${userId}`
                        + ` (attempt ${attempt + 1}/${delays.length})`);
                    await this.stopListener(userId);
                }
                else {
                    await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
                }
                await this.waitForListenerLeaseReleased(userId);
                if (delay > 0)
                    await new Promise(r => setTimeout(r, delay));
                await this.startListener(userId, sessionString);
                const listener = this.listeners.get(userId);
                if (!listener)
                    throw new Error('Failed to start listener for user');
                if (!listener.isTelegramConnected()) {
                    await listener.ensureTelegramConnected('user_reconnect');
                }
                const channels = await listener.listChannels({ skipColdDelay: true });
                return { channels };
            }
            catch (err) {
                lastErr = err;
                if (err instanceof telegramClient_1.TelegramSessionInvalidError)
                    throw err;
                console.warn(`[sessionManager] user reconnect attempt ${attempt + 1} failed for ${userId}:`, err instanceof Error ? err.message : err);
            }
        }
        console.error(`[sessionManager] user reconnect exhausted for ${userId}`
            + ' — invalidating session so UI can re-link', lastErr instanceof Error ? lastErr.message : lastErr);
        await this.invalidateTelegramSession(userId);
        throw new telegramClient_1.TelegramSessionInvalidError('Could not reconnect Telegram. Please link your account again.');
    }
    /**
     * User Disconnect: drop pending auth, stop listener immediately, delete session row.
     * Configured telegram_channels are kept.
     */
    async disconnectTelegramSession(userId) {
        await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId);
        if (this.listeners.has(userId)) {
            await this.stopListener(userId);
        }
        else {
            await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
        }
        const { error } = await this.supabase.from('telegram_sessions').delete().eq('user_id', userId);
        if (error) {
            console.warn(`[sessionManager] disconnectTelegramSession delete failed for ${userId}:`, error.message);
        }
        return { ok: true };
    }
    async ensureListener(userId) {
        if (this.shuttingDown) {
            throw new Error('Telegram worker is shutting down');
        }
        const existing = this.listeners.get(userId);
        if (existing) {
            if (!existing.isTelegramConnected()) {
                await existing.ensureTelegramConnected('ensure_listener');
            }
            return existing;
        }
        if (!workerConfig_1.workerConfig.runsListener) {
            throw new Error('Live Telegram listener not available on this worker');
        }
        if (await this.shouldSkipListenerStart(userId)) {
            const reason = await this.listenerStartBlockReason(userId);
            throw new Error(reason ?? 'Telegram listener is unavailable for this account.');
        }
        const { data: sess, error } = await this.supabase
            .from('telegram_sessions')
            .select('session_string, is_active')
            .eq('user_id', userId)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to load session: ${error.message}`);
        if (!sess?.session_string)
            throw new Error('No Telegram session for this user');
        if (!sess.is_active)
            throw new Error('Telegram session is paused');
        await this.startListener(userId, sess.session_string);
        const listener = this.listeners.get(userId);
        if (!listener)
            throw new Error('Failed to start listener for user');
        return listener;
    }
    async backfillChannelHistory(userId, channelRowId, days, opts) {
        // Prefer the live listener (listener-only deploys). Avoids a second MTProto
        // connection that would trigger AUTH_KEY_DUPLICATED.
        if (workerConfig_1.workerConfig.runsListener) {
            let listener = this.listeners.get(userId);
            if (!listener?.isTelegramConnected()) {
                try {
                    listener = await this.ensureListener(userId);
                }
                catch {
                    listener = undefined;
                }
            }
            if (listener?.isTelegramConnected()) {
                return listener.backfillChannelHistory(channelRowId, days, opts);
            }
        }
        if (!workerConfig_1.workerConfig.runsBacktestHttp) {
            throw new Error('Telegram listener is not connected. Link Telegram on Copier Engine, wait a few seconds, then refresh.');
        }
        return this.withEphemeralTelegram(userId, () => (0, backtestSync_1.runWithEphemeralListener)(this.supabase, userId, listener => listener.backfillChannelHistory(channelRowId, days, opts)));
    }
    async importBacktestChannelHistory(userId, channelRowId, fromIso, toIso) {
        if (!workerConfig_1.workerConfig.runsBacktestHttp) {
            throw new Error('Backtest not enabled on this worker');
        }
        return this.withEphemeralTelegram(userId, () => (0, backtestSync_1.runWithEphemeralListener)(this.supabase, userId, listener => listener.importBacktestChannelHistory(channelRowId, fromIso, toIso)));
    }
    async syncBacktestSignals(userId, channelRowId, fromIso, toIso, runId) {
        if (!workerConfig_1.workerConfig.runsBacktestHttp) {
            throw new Error('Backtest sync is not enabled on this worker. Use a WORKER_ROLE=backtest or all service.');
        }
        if (workerConfig_1.workerConfig.role === 'listener') {
            throw new Error('Backtest sync blocked on listener-only workers. Point BACKTEST_WORKER_URL to a backtest service.');
        }
        return this.withEphemeralTelegram(userId, () => (0, backtestSync_1.runEphemeralBacktestSync)(this.supabase, userId, channelRowId, fromIso, toIso, runId));
    }
    /**
     * Runs fn while the live listener is stopped so ephemeral Telegram can use the sole
     * MTProto slot — including across dedicated backtest vs listener workers.
     */
    async withEphemeralTelegram(userId, fn) {
        if (this.shuttingDown) {
            throw new Error('Telegram worker is shutting down');
        }
        const pauseLiveLocal = workerConfig_1.workerConfig.runsListener
            && (workerConfig_1.workerConfig.role === 'all' || process.env.BACKTEST_PAUSE_LIVE_LISTENER !== 'false');
        let sessionString = null;
        let hadLiveListener = false;
        let crossServiceHold = false;
        if (pauseLiveLocal) {
            sessionString = (await this.supabase
                .from('telegram_sessions')
                .select('session_string')
                .eq('user_id', userId)
                .maybeSingle()).data?.session_string ?? null;
            hadLiveListener = this.listeners.has(userId);
            if (hadLiveListener) {
                console.log(`[sessionManager] pausing live listener for ephemeral Telegram user=${userId}`);
                await this.stopListener(userId);
            }
            if (sessionString) {
                await new Promise(r => setTimeout(r, authKeyReleaseDelayMs()));
            }
        }
        else {
            // Dedicated backtest worker: pause remote listener via DB hold.
            crossServiceHold = await this.acquireMtprotoHold(userId);
            await this.waitForListenerLeaseReleased(userId);
            await new Promise(r => setTimeout(r, authKeyReleaseDelayMs()));
        }
        try {
            return await fn();
        }
        finally {
            if (pauseLiveLocal && sessionString && hadLiveListener) {
                await this.restartListenerAfterBacktest(userId, sessionString);
            }
            if (crossServiceHold) {
                await this.releaseMtprotoHold(userId);
            }
        }
    }
    /** Backtest pauses the copier listener; retry MTProto restart so Telegram does not stay offline. */
    async restartListenerAfterBacktest(userId, sessionString) {
        const retryDelaysMs = [0, 3000, 5000, 10000];
        for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
            const delay = retryDelaysMs[attempt] ?? 0;
            if (delay > 0)
                await new Promise(r => setTimeout(r, delay));
            if (this.listeners.has(userId)) {
                console.log(`[sessionManager] listener restored after backtest user=${userId}`);
                return;
            }
            try {
                await this.startListener(userId, sessionString);
            }
            catch (err) {
                console.warn(`[sessionManager] restart listener after backtest attempt ${attempt + 1} for ${userId}:`, err instanceof Error ? err.message : err);
            }
            if (this.listeners.has(userId))
                return;
        }
        console.error(`[sessionManager] failed to restart listener after backtest user=${userId}`
            + ' — open Copier Engine and use Reconnect Telegram');
    }
    async startListener(userId, sessionString) {
        if (this.shuttingDown)
            return;
        if (this.listeners.has(userId))
            return;
        if (!(0, workerConfig_1.userBelongsToShard)(userId))
            return;
        if (await this.shouldSkipListenerStart(userId)) {
            console.log(`[sessionManager] skip listener for ${userId}: auth in progress`);
            return;
        }
        await this.withConnectionLock(userId, async () => {
            if (this.shuttingDown)
                return;
            if (this.listeners.has(userId))
                return;
            if (await this.shouldSkipListenerStart(userId))
                return;
            const lease = await (0, sessionLease_1.acquireSessionLease)(this.supabase, userId);
            if (!lease.ok) {
                console.warn(`[sessionManager] skip listener for ${userId}: ${lease.reason}`);
                return;
            }
            const listener = new userListener_1.UserListener(userId, sessionString, this.supabase, undefined, (id, reason) => this.onAuthKeyDuplicatedRecoveryExhausted(id, reason));
            if (this.tradeExecutor) {
                listener.setOnSignalParsed(row => listenerInProcessDispatch(this.tradeExecutor, row));
            }
            try {
                await withTimeout(listener.start(), listenerStartTimeoutMs(), `listener.start ${userId}`);
            }
            catch (err) {
                try {
                    await listener.stop();
                }
                catch { /* ignore */ }
                await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
                if (err instanceof telegramClient_1.TelegramSessionInvalidError) {
                    // Do not call invalidateTelegramSession here — it re-enters
                    // withConnectionLock while we still hold it (deadlock).
                    await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId);
                    const { error } = await this.supabase.from('telegram_sessions').delete().eq('user_id', userId);
                    if (error) {
                        console.warn(`[sessionManager] session delete after invalid start failed for ${userId}:`, error.message);
                    }
                }
                throw err;
            }
            this.listeners.set(userId, listener);
            this.recentlyFailed.delete(userId);
            this.disconnectedRenewTicks.delete(userId);
            console.log(`[sessionManager] Started listener for user ${userId}`);
        });
    }
    async disconnectListener(userId) {
        const listener = this.listeners.get(userId);
        if (!listener)
            return;
        await listener.stop();
        this.listeners.delete(userId);
        this.disconnectedRenewTicks.delete(userId);
        await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
        console.log(`[sessionManager] Stopped listener for user ${userId}`);
    }
    async stopListener(userId) {
        await this.withConnectionLock(userId, async () => {
            await this.disconnectListener(userId);
        });
    }
    async reconcileUserSignals(userId, opts) {
        if (!(0, workerConfig_1.userBelongsToShard)(userId)) {
            return { ok: false, reason: 'wrong_shard' };
        }
        const listener = this.listeners.get(userId);
        if (!listener) {
            return { ok: false, reason: 'listener_not_running' };
        }
        let channelRow;
        if (opts?.channelRowId) {
            const { data } = await this.supabase
                .from('telegram_channels')
                .select('id, channel_id, channel_username, last_seen_message_id, last_seen_at, last_live_at')
                .eq('id', opts.channelRowId)
                .eq('user_id', userId)
                .maybeSingle();
            if (data)
                channelRow = data;
        }
        const stats = await listener.runSignalTelegramReconcile('cron', channelRow);
        return { ok: true, stats };
    }
    async reconcileAllListenersOnShard() {
        const totals = { checked: 0, mismatches: 0, revised: 0, errors: 0 };
        let users = 0;
        for (const [, listener] of this.listeners) {
            users += 1;
            const stats = await listener.runSignalTelegramReconcile('cron');
            totals.checked += stats.checked;
            totals.mismatches += stats.mismatches;
            totals.revised += stats.revised;
            totals.errors += stats.errors;
        }
        return { users, stats: totals };
    }
    async disconnectAll() {
        this.shuttingDown = true;
        if (this.channelChannel) {
            try {
                await this.supabase.removeChannel(this.channelChannel);
            }
            catch { /* noop */ }
            this.channelChannel = null;
        }
        if (this.authPendingChannel) {
            try {
                await this.supabase.removeChannel(this.authPendingChannel);
            }
            catch { /* noop */ }
            this.authPendingChannel = null;
        }
        this.stopChannelListenerServices();
        const entries = Array.from(this.listeners.entries());
        const stopResults = await Promise.allSettled(entries.map(async ([userId, listener]) => {
            try {
                await listener.stop();
                console.log(`[sessionManager] Disconnected ${userId}`);
            }
            finally {
                try {
                    await (0, sessionLease_1.releaseSessionLease)(this.supabase, userId);
                }
                catch (err) {
                    console.error(`[sessionManager] lease release failed during shutdown user=${userId}:`, err instanceof Error ? err.message : err);
                    (0, sentry_1.captureWorkerWarning)(err instanceof Error ? err : new Error(String(err)), {
                        subsystem: 'worker',
                        operation: 'lease_release_failed',
                        errorCode: 'LEASE_RELEASE_FAILED',
                        fingerprint: ['worker', 'LEASE_RELEASE_FAILED', (0, workerConfig_1.leaseRoleLabel)()],
                        context: {
                            user_id: userId,
                            stage: 'shutdown',
                        },
                    });
                }
            }
        }));
        for (let i = 0; i < stopResults.length; i++) {
            const result = stopResults[i];
            if (result.status === 'rejected') {
                const userId = entries[i]?.[0] ?? 'unknown';
                console.error(`[sessionManager] listener disconnect failed during shutdown user=${userId}:`, result.reason instanceof Error ? result.reason.message : result.reason);
                (0, sentry_1.captureWorkerError)(result.reason instanceof Error ? result.reason : new Error(String(result.reason)), {
                    subsystem: 'worker',
                    operation: 'listener_disconnect_failed',
                    errorCode: 'LISTENER_DISCONNECT_FAILED',
                    fingerprint: ['worker', 'LISTENER_DISCONNECT_FAILED', (0, workerConfig_1.leaseRoleLabel)()],
                    context: {
                        user_id: userId,
                        stage: 'shutdown',
                    },
                });
            }
        }
        await (0, sessionLease_1.releaseOwnedSessionLeases)(this.supabase);
        this.listeners.clear();
        const unresolvedLeases = await (0, sessionLease_1.listOwnedActiveLeases)(this.supabase).catch(err => {
            console.error('[sessionManager] failed to check unresolved leases after shutdown:', err instanceof Error ? err.message : err);
            return [];
        });
        if (unresolvedLeases.length > 0) {
            console.error(`[sessionManager] unresolved owned leases after shutdown count=${unresolvedLeases.length}`
                + ` users=${unresolvedLeases.map(l => l.user_id).join(',')}`);
            (0, sentry_1.captureWorkerError)(new Error('Unresolved owned listener leases after shutdown'), {
                subsystem: 'worker',
                operation: 'unresolved_listener_leases',
                errorCode: 'UNRESOLVED_LISTENER_LEASES',
                fingerprint: ['worker', 'UNRESOLVED_LISTENER_LEASES', (0, workerConfig_1.leaseRoleLabel)()],
                context: {
                    stage: 'shutdown',
                    extra: {
                        unresolved_count: unresolvedLeases.length,
                    },
                },
            });
        }
    }
    onAuthKeyDuplicatedRecoveryExhausted(userId, reason) {
        console.error(`[sessionManager] AUTH_KEY_DUPLICATED recovery exhausted user=${userId}`
            + ` reason=${reason} — invalidating session so UI can re-link`);
        (0, sentry_1.captureWorkerError)(new Error('AUTH_KEY_DUPLICATED recovery exhausted'), {
            subsystem: 'telegram',
            operation: 'auth_key_duplicated_exhausted',
            errorCode: 'AUTH_KEY_DUPLICATED',
            fingerprint: ['telegram', 'AUTH_KEY_DUPLICATED', 'exhausted'],
            context: {
                user_id: userId,
                stage: 'auth_key_duplicated_recovery',
                extra: { reason },
            },
        });
        void this.invalidateTelegramSession(userId).catch(err => console.error(`[sessionManager] AUTH_KEY_DUPLICATED invalidation failed user=${userId}:`, err instanceof Error ? err.message : err));
    }
}
exports.UserSessionManager = UserSessionManager;
