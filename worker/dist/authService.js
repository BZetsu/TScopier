"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const tl_1 = require("telegram/tl");
const Password_1 = require("telegram/Password");
const telegramClient_1 = require("./telegramClient");
const telegramAccountClaims_1 = require("./telegramAccountClaims");
const telegramQrAuth_1 = require("./telegramQrAuth");
const telegramAuthRecovery_1 = require("./telegramAuthRecovery");
/**
 * Maximum age of a pending auth (between send_code and verify_code)
 * before we drop the in-memory client. Telegram codes expire in a few minutes;
 * DB-backed recovery lasts slightly longer for cross-replica / slow UX.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Extra in-memory window once Telegram asked for 2FA (user is typing the password). */
const PENDING_PASSWORD_TTL_MS = 20 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
/** DB row outlives Telegram code validity slightly so retries still recover across replicas. */
const PENDING_DB_TTL_MS = 12 * 60 * 1000;
/** Longer DB TTL while waiting for Two-Step Verification password. */
const PENDING_DB_PASSWORD_TTL_MS = 20 * 60 * 1000;
const QR_FIRST_TOKEN_WAIT_MS = 15000;
const QR_PASSWORD_WAIT_MS = 120000;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function normalizePhoneNumber(raw) {
    return (0, telegramAccountClaims_1.normalizeTelegramPhoneNumber)(raw);
}
function phonesMatch(a, b) {
    return normalizePhoneNumber(a) === normalizePhoneNumber(b);
}
function normalizeVerificationCode(raw) {
    return String(raw ?? '').replace(/\D/g, '');
}
/** Map Telegram SentCode type to a simple delivery channel for the UI. */
function sentCodeDelivery(result) {
    const className = String(result.type?.className ?? '');
    if (/App/i.test(className))
        return 'app';
    if (/Sms/i.test(className))
        return 'sms';
    if (/Call|Flash/i.test(className))
        return 'call';
    return 'other';
}
function logAuthEvent(event, extra) {
    const parts = [`[authService] event=${event}`];
    if (extra) {
        for (const [k, v] of Object.entries(extra)) {
            const val = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
            parts.push(`${k}=${val}`);
        }
    }
    console.log(parts.join(' '));
}
function authCorrelationId() {
    return crypto.randomUUID().slice(0, 8);
}
/**
 * Owns the MTProto connection during the send_code -> verify_code window.
 * The same TelegramClient is kept alive across both calls so we never re-auth
 * to a different DC. On success the live client is handed off to the
 * UserSessionManager and becomes the long-running listener client — there
 * is exactly one TCP connection per user from auth onward.
 */
class AuthService {
    constructor(supabase, sessionManager) {
        this.supabase = supabase;
        this.sessionManager = sessionManager;
        this.pending = new Map();
        /** True from auth start until pending Map entry is ready — blocks listener restart. */
        this.authInFlight = new Set();
        this.qrPasswordResolvers = new Map();
        this.sessionManager.setAuthGuard(userId => this.pending.has(userId) || this.authInFlight.has(userId));
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
            if (this.pending.size > 0) {
                const oldestAge = Math.max(0, ...Array.from(this.pending.values()).map(p => Date.now() - p.createdAt));
                logAuthEvent('auth_heartbeat', {
                    pendingCount: this.pending.size,
                    inFlightCount: this.authInFlight.size,
                    oldestPendingAgeMs: oldestAge,
                });
            }
        }, CLEANUP_INTERVAL_MS);
        if (typeof this.cleanupTimer.unref === 'function')
            this.cleanupTimer.unref();
    }
    async shutdown() {
        clearInterval(this.cleanupTimer);
        const disconnects = [...this.pending.entries()].map(async ([userId, p]) => {
            try {
                await p.client.disconnect();
            }
            catch (err) {
                console.warn(`[authService] pending auth disconnect failed for user ${userId}:`, err instanceof Error ? err.message : err);
            }
        });
        await Promise.allSettled(disconnects);
        this.pending.clear();
        this.authInFlight.clear();
        this.qrPasswordResolvers.clear();
    }
    pendingTtlMs(p) {
        if (p.method === 'phone' && p.awaitingPassword)
            return PENDING_PASSWORD_TTL_MS;
        if (p.method === 'qr' && p.status === 'requires_password')
            return PENDING_PASSWORD_TTL_MS;
        return PENDING_TTL_MS;
    }
    cleanup() {
        const now = Date.now();
        for (const [userId, p] of this.pending) {
            if (now - p.createdAt > this.pendingTtlMs(p)) {
                p.client.disconnect().catch(() => { });
                this.pending.delete(userId);
                this.qrPasswordResolvers.delete(userId);
                console.log(`[authService] expired pending auth for user ${userId}`);
            }
        }
        void this.supabase
            .from('telegram_auth_pending')
            .delete()
            .lt('expires_at', new Date(now).toISOString())
            .then(({ error }) => {
            if (error)
                console.warn('[authService] telegram_auth_pending cleanup:', error.message);
        });
    }
    async clearPendingRow(userId, source = 'unspecified') {
        console.log(`[authService] clearPendingRow user=${userId} source=${source}`);
        await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId);
    }
    async disconnectPending(userId, source = 'unspecified') {
        const existing = this.pending.get(userId);
        console.log(`[authService] disconnectPending user=${userId} source=${source} has_pending=${!!existing}`);
        if (existing) {
            try {
                await existing.client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
        }
        this.qrPasswordResolvers.delete(userId);
    }
    /**
     * When verify hits a different process than send_code, rebuild MTProto from the
     * persisted phone_code_hash (same approach as reconnecting after app restart).
     */
    async restorePhonePendingFromDatabase(userId, phone) {
        const { data: row, error } = await this.supabase
            .from('telegram_auth_pending')
            .select('phone, phone_code_hash, expires_at, awaiting_password, auth_session_string, auth_method')
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !row)
            return null;
        // Only restore real phone auth rows — never QR or ephemeral MTProto holds.
        if (row.auth_method && row.auth_method !== 'phone')
            return null;
        if (!row.phone_code_hash)
            return null;
        if (new Date(row.expires_at) < new Date()) {
            await this.clearPendingRow(userId);
            return null;
        }
        if (!row.phone || !phonesMatch(row.phone, phone)) {
            console.warn(`[authService] verify phone mismatch for user ${userId}`);
            return null;
        }
        const awaitingPassword = Boolean(row.awaiting_password);
        const savedSession = typeof row.auth_session_string === 'string' && row.auth_session_string.trim()
            ? row.auth_session_string.trim()
            : '';
        // 2FA resume requires the persisted MTProto session from SignIn; without it the
        // user must request a new code.
        if (awaitingPassword && !savedSession) {
            console.warn(`[authService] awaiting password but missing auth_session_string for ${userId}`);
            return null;
        }
        const client = (0, telegramClient_1.buildClient)(savedSession);
        await client.connect();
        return {
            method: 'phone',
            client,
            phone: row.phone,
            phoneCodeHash: row.phone_code_hash ?? '',
            createdAt: Date.now(),
            awaitingPassword,
        };
    }
    async restoreQrPendingFromDatabase(userId) {
        const { data: row, error } = await this.supabase
            .from('telegram_auth_pending')
            .select('expires_at, auth_session_string, awaiting_password, qr_expires_at, phone, auth_method')
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !row || row.auth_method !== 'qr')
            return null;
        if (new Date(row.expires_at) < new Date()) {
            await this.clearPendingRow(userId);
            return null;
        }
        const sessionString = typeof row.auth_session_string === 'string' && row.auth_session_string.trim()
            ? row.auth_session_string.trim()
            : '';
        if (!sessionString)
            return null;
        const client = (0, telegramClient_1.buildClient)(sessionString);
        await client.connect();
        const pending = {
            method: 'qr',
            client,
            latestQrUrl: '',
            expiresAt: row.qr_expires_at ? new Date(row.qr_expires_at).getTime() : 0,
            status: row.awaiting_password ? 'requires_password' : 'waiting',
            createdAt: Date.now(),
            phone: row.phone ?? undefined,
        };
        if (pending.status === 'waiting') {
            void this.runQrLoginBackground(userId, pending);
        }
        return pending;
    }
    async persistAwaitingPassword(userId, client, pending) {
        const authSessionString = client.session.save();
        const expiresAt = new Date(Date.now() + PENDING_DB_PASSWORD_TTL_MS).toISOString();
        // Upsert: a plain UPDATE matches 0 rows if cleanup deleted the send_code row mid-flight.
        const { error } = await this.supabase.from('telegram_auth_pending').upsert({
            user_id: userId,
            auth_method: 'phone',
            phone: pending?.phone ?? null,
            phone_code_hash: pending?.phoneCodeHash ?? null,
            expires_at: expiresAt,
            awaiting_password: true,
            auth_session_string: authSessionString,
        }, { onConflict: 'user_id' });
        if (error) {
            console.warn(`[authService] persistAwaitingPassword failed for ${userId}:`, error.message);
        }
        if (pending) {
            pending.awaitingPassword = true;
            // Refresh in-memory age so cleanup does not expire mid-password entry.
            pending.createdAt = Date.now();
        }
    }
    async persistQrPendingRow(userId, client, pending) {
        const authSessionString = client.session.save();
        const expiresAt = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString();
        const { error } = await this.supabase.from('telegram_auth_pending').upsert({
            user_id: userId,
            auth_method: 'qr',
            phone: pending.phone ?? null,
            phone_code_hash: null,
            expires_at: expiresAt,
            auth_session_string: authSessionString,
            awaiting_password: pending.status === 'requires_password',
            qr_expires_at: pending.expiresAt > 0 ? new Date(pending.expiresAt).toISOString() : null,
        }, { onConflict: 'user_id' });
        if (error) {
            console.warn(`[authService] persistQrPendingRow failed for ${userId}:`, error.message);
        }
    }
    async completePasswordStep(client, password) {
        const srpResult = await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.account.GetPassword());
        const srpCheck = await (0, Password_1.computeCheck)(srpResult, password);
        await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.CheckPassword({ password: srpCheck }));
    }
    async finalizeAuth(client, userId, phone, correlationId) {
        const sessionString = client.session.save();
        logAuthEvent('finalize_auth_start', { userId, phone, correlationId });
        const tStart = Date.now();
        const me = await client.getMe();
        const telegramUserId = me.id?.toString?.() ?? String(me.id);
        logAuthEvent('finalize_auth_got_user', { userId, telegramUserId, correlationId });
        await (0, telegramAccountClaims_1.assertTelegramAccountAvailable)(this.supabase, userId, {
            phone,
            telegramUserId,
        });
        const { data: row, error: dbErr } = await this.supabase
            .from('telegram_sessions')
            .upsert({
            user_id: userId,
            session_string: sessionString,
            phone_number: phone,
            is_active: true,
            listener_engine: 'gramjs',
        }, { onConflict: 'user_id' })
            .select('id')
            .single();
        if (dbErr || !row) {
            logAuthEvent('finalize_auth_db_failed', { userId, correlationId, error: dbErr?.message ?? 'no row returned', timeMs: Date.now() - tStart });
            console.error(`[authService] finalizeAuth db_upsert_failed user=${userId}: ${dbErr?.message ?? 'no row returned'}`);
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            await this.clearPendingRow(userId, 'finalizeAuth_db_fail');
            throw new Error(dbErr?.message ?? 'Failed to persist Telegram session');
        }
        try {
            await (0, telegramAccountClaims_1.upsertTelegramAccountClaim)(this.supabase, userId, {
                phone,
                telegramUserId,
            });
            logAuthEvent('finalize_auth_claim_ok', { userId, telegramUserId, correlationId });
        }
        catch (claimErr) {
            logAuthEvent('finalize_auth_claim_failed', { userId, correlationId, error: claimErr instanceof Error ? claimErr.message : String(claimErr) });
            console.error(`[authService] finalizeAuth claim_failed user=${userId}:`, claimErr instanceof Error ? claimErr.message : claimErr);
            await this.supabase.from('telegram_sessions').delete().eq('user_id', userId);
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            await this.clearPendingRow(userId, 'finalizeAuth_claim_fail');
            throw claimErr;
        }
        this.pending.delete(userId);
        await this.clearPendingRow(userId, 'finalizeAuth_success');
        let channels;
        try {
            logAuthEvent('finalize_auth_adopting', { userId, correlationId });
            await this.sessionManager.adoptClient(userId, client, sessionString);
            try {
                channels = await this.sessionManager.listChannelsForAdoptedUser(userId, { skipColdDelay: true });
                logAuthEvent('finalize_auth_channels_ok', { userId, channelCount: channels?.length ?? 0, correlationId });
            }
            catch (listErr) {
                logAuthEvent('finalize_auth_channels_failed', { userId, correlationId, error: listErr instanceof Error ? listErr.message : String(listErr) });
                console.warn(`[authService] listChannels after auth failed for ${userId}:`, listErr);
            }
        }
        catch (err) {
            logAuthEvent('finalize_auth_adopt_failed', { userId, correlationId, error: err instanceof Error ? err.message : String(err) });
            console.error(`[authService] adoptClient failed for ${userId}:`, err);
            try {
                await client.disconnect();
            }
            catch {
                /* ignore */
            }
        }
        logAuthEvent('finalize_auth_complete', { userId, sessionId: row.id, totalTimeMs: Date.now() - tStart, correlationId });
        return { ok: true, session_id: row.id, channels };
    }
    async runQrLoginBackground(userId, pending, correlationId = authCorrelationId()) {
        const { client } = pending;
        logAuthEvent('qr_login_bg_start', { userId, correlationId });
        try {
            await client.signInUserWithQrCode({ apiId: telegramClient_1.API_ID, apiHash: telegramClient_1.API_HASH }, {
                qrCode: async ({ token, expires }) => {
                    pending.latestQrUrl = (0, telegramQrAuth_1.formatQrLoginUrl)(Buffer.isBuffer(token) ? token : Buffer.from(token));
                    pending.expiresAt = expires * 1000;
                    console.log(`[authService] QR token received user=${userId} expires_at=${pending.expiresAt}`);
                    await this.persistQrPendingRow(userId, client, pending);
                },
                password: async (hint) => {
                    console.log(`[authService] QR requires password user=${userId} hint=${hint ?? 'none'}`);
                    pending.status = 'requires_password';
                    pending.passwordHint = hint;
                    await this.persistAwaitingPassword(userId, client);
                    return new Promise((resolve, reject) => {
                        this.qrPasswordResolvers.set(userId, { resolve, reject });
                    });
                },
                onError: async (err) => {
                    console.warn(`[authService] QR login onError user=${userId}:`, err.message);
                    if ((0, telegramClient_1.isAuthKeyUnregistered)(err)) {
                        throw new Error('AUTH_KEY_UNREGISTERED');
                    }
                    return false;
                },
            });
            console.log(`[authService] QR signIn completed user=${userId} — calling finalizeAuth`);
            const me = await client.getMe();
            const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? '';
            pending.phone = phone;
            // Mark success only after finalizeAuth returns. finalizeAuth clears the Map
            // entry — re-attach so the next poll can observe success without racing.
            const result = await this.finalizeAuth(client, userId, phone || `tg:${me.id}`, correlationId);
            pending.status = 'success';
            pending.result = result;
            this.pending.set(userId, pending);
            logAuthEvent('qr_login_succeeded', { userId, correlationId });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pending.status = 'error';
            pending.error = msg;
            console.error(`[authService] QR login failed user=${userId} error=${msg}`);
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            // Keep pending entry with error status so getQrStatus poll can surface
            // the specific error (e.g. TELEGRAM_ALREADY_LINKED) to the frontend.
            // Cleanup happens on next auth attempt or periodic cleanup.
            await this.clearPendingRow(userId);
        }
    }
    async getOrRestoreQrPending(userId) {
        const existing = this.pending.get(userId);
        if (existing?.method === 'qr')
            return existing;
        const restored = await this.restoreQrPendingFromDatabase(userId);
        if (restored) {
            this.pending.set(userId, restored);
            return restored;
        }
        return null;
    }
    async sendCode(userId, phone) {
        const correlationId = authCorrelationId();
        const normalizedPhone = normalizePhoneNumber(phone);
        logAuthEvent('send_code_start', { userId, rawPhone: phone, normalizedPhone, correlationId });
        if (!normalizedPhone || !normalizedPhone.startsWith('+')) {
            logAuthEvent('send_code_invalid_phone', { userId, phone, correlationId });
            console.warn(`[authService] send_code invalid phone format user=${userId} phone=${phone}`);
            throw new Error('Use full phone with country code, e.g. +44...');
        }
        await (0, telegramAccountClaims_1.assertTelegramAccountAvailable)(this.supabase, userId, { phone: normalizedPhone });
        this.authInFlight.add(userId);
        const tStart = Date.now();
        try {
            await this.disconnectPending(userId, 'send_code');
            // Upsert placeholder first so there is never an empty-pending window that
            // lets onAuthPendingCleared / syncSessions restart the old live session
            // (which would swallow the in-app login code).
            const placeholderExpires = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString();
            const { error: holdErr } = await this.supabase.from('telegram_auth_pending').upsert({
                user_id: userId,
                auth_method: 'phone',
                phone: normalizedPhone,
                phone_code_hash: null,
                expires_at: placeholderExpires,
                awaiting_password: false,
                auth_session_string: null,
                qr_expires_at: null,
            }, { onConflict: 'user_id' });
            if (holdErr) {
                logAuthEvent('send_code_hold_failed', { userId, correlationId, error: holdErr.message });
                console.error('[authService] auth hold upsert failed:', holdErr.message);
                throw new Error('Could not start Telegram login. Try again in a minute.');
            }
            await this.sessionManager.prepareForAuth(userId);
            const client = (0, telegramClient_1.buildClient)('');
            logAuthEvent('send_code_connecting', { userId, correlationId });
            await client.connect();
            logAuthEvent('send_code_connected', { userId, correlationId, connectTimeMs: Date.now() - tStart });
            try {
                const tApi = Date.now();
                logAuthEvent('send_code_calling_api', { userId, normalizedPhone, correlationId });
                const result = await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SendCode({
                    phoneNumber: normalizedPhone,
                    apiId: telegramClient_1.API_ID,
                    apiHash: telegramClient_1.API_HASH,
                    settings: new tl_1.Api.CodeSettings({
                        allowFlashcall: false,
                        currentNumber: true,
                        allowAppHash: true,
                    }),
                }));
                logAuthEvent('send_code_api_ok', {
                    userId, correlationId, apiTimeMs: Date.now() - tApi,
                    delivery: sentCodeDelivery(result), hash: result.phoneCodeHash,
                });
                const authSessionString = client.session.save();
                this.pending.set(userId, {
                    method: 'phone',
                    client,
                    phone: normalizedPhone,
                    phoneCodeHash: result.phoneCodeHash,
                    createdAt: Date.now(),
                });
                const expiresAt = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString();
                const { error: dbErr } = await this.supabase.from('telegram_auth_pending').upsert({
                    user_id: userId,
                    auth_method: 'phone',
                    phone: normalizedPhone,
                    phone_code_hash: result.phoneCodeHash,
                    expires_at: expiresAt,
                    awaiting_password: false,
                    auth_session_string: authSessionString,
                    qr_expires_at: null,
                }, { onConflict: 'user_id' });
                if (dbErr) {
                    logAuthEvent('send_code_db_upsert_warn', { userId, correlationId, error: dbErr.message });
                    console.error('[authService] telegram_auth_pending upsert:', dbErr.message);
                }
                logAuthEvent('send_code_complete', { userId, correlationId, totalTimeMs: Date.now() - tStart });
                return {
                    phone_code_hash: result.phoneCodeHash,
                    delivery: sentCodeDelivery(result),
                };
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logAuthEvent('send_code_api_failed', { userId, correlationId, error: errMsg, totalTimeMs: Date.now() - tStart });
                console.warn(`[authService] send_code Telegram API failed user=${userId}:`, errMsg);
                try {
                    await client.disconnect();
                }
                catch { /* ignore */ }
                this.pending.delete(userId);
                await this.clearPendingRow(userId);
                throw err;
            }
        }
        finally {
            this.authInFlight.delete(userId);
        }
    }
    async verifyCode(userId, phone, code, password) {
        const correlationId = authCorrelationId();
        const normalizedPhone = normalizePhoneNumber(phone);
        const normalizedCode = normalizeVerificationCode(code);
        logAuthEvent('verify_code_start', { userId, correlationId, hasCode: !!normalizedCode, hasPassword: !!password });
        if (!normalizedCode) {
            logAuthEvent('verify_code_missing', { userId, correlationId });
            throw new Error('Verification code is required');
        }
        const tStart = Date.now();
        await this.sessionManager.pauseForAuth(userId, { releaseDelay: false });
        let pending;
        const mem = this.pending.get(userId);
        if (mem?.method === 'phone')
            pending = mem;
        if (!pending) {
            const restored = await this.restorePhonePendingFromDatabase(userId, normalizedPhone);
            if (restored) {
                logAuthEvent('verify_code_restored_db', { userId, correlationId });
                pending = restored;
                this.pending.set(userId, restored);
            }
        }
        if (!pending) {
            logAuthEvent('verify_code_no_pending', { userId, correlationId });
            console.warn(`[authService] verifyCode no pending user=${userId}`);
            const err = new Error((0, telegramAuthRecovery_1.noPendingPhoneAuthMessage)());
            err.name = telegramAuthRecovery_1.NO_PENDING_PHONE_AUTH_ERROR;
            throw err;
        }
        const { client, phone: pendingPhone, phoneCodeHash } = pending;
        if (!client.connected) {
            logAuthEvent('verify_code_reconnect_client', { userId, correlationId });
            try {
                await client.connect();
            }
            catch { /* will fail at tgInvoke */ }
        }
        try {
            if (pending.awaitingPassword) {
                logAuthEvent('verify_code_password_step', { userId, correlationId });
                if (!password?.trim()) {
                    throw new Error('Two-step verification password is required');
                }
                const tPwd = Date.now();
                await this.completePasswordStep(client, password.trim());
                logAuthEvent('verify_code_password_ok', { userId, correlationId, pwdTimeMs: Date.now() - tPwd });
            }
            else if (password?.trim()) {
                try {
                    logAuthEvent('verify_code_signin_with_password', { userId, correlationId });
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: pendingPhone,
                        phoneCodeHash,
                        phoneCode: normalizedCode,
                    }));
                }
                catch (signInErr) {
                    const msg = signInErr instanceof Error ? signInErr.message : String(signInErr);
                    logAuthEvent('verify_code_signin_result', { userId, correlationId, error: msg });
                    if (!msg.includes('SESSION_PASSWORD_NEEDED'))
                        throw signInErr;
                    await this.persistAwaitingPassword(userId, client, pending);
                    const tPwd = Date.now();
                    await this.completePasswordStep(client, password.trim());
                    logAuthEvent('verify_code_password_completed', { userId, correlationId, pwdTimeMs: Date.now() - tPwd });
                }
            }
            else {
                try {
                    logAuthEvent('verify_code_signin', { userId, correlationId });
                    const tSign = Date.now();
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: pendingPhone,
                        phoneCodeHash,
                        phoneCode: normalizedCode,
                    }));
                    logAuthEvent('verify_code_signin_ok', { userId, correlationId, signTimeMs: Date.now() - tSign });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
                        logAuthEvent('verify_code_needs_2fa', { userId, correlationId });
                        await this.persistAwaitingPassword(userId, client, pending);
                        return { requires_password: true };
                    }
                    const errCat = (0, telegramAuthRecovery_1.isRecoverableTelegramAuthError)(err) ? 'recoverable' : 'fatal';
                    logAuthEvent('verify_code_signin_error', { userId, correlationId, error: msg, category: errCat });
                    throw err;
                }
            }
        }
        catch (err) {
            // Wrong 2FA / transient errors: keep pending so the user can retry without send_code.
            if ((0, telegramAuthRecovery_1.isRecoverableTelegramAuthError)(err) && !(0, telegramAuthRecovery_1.isPhoneCodeFatalAuthError)(err)) {
                if (pending.awaitingPassword) {
                    await this.persistAwaitingPassword(userId, client, pending).catch(() => { });
                }
                throw err;
            }
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            await this.clearPendingRow(userId);
            throw err;
        }
        return this.finalizeAuth(client, userId, pendingPhone, correlationId);
    }
    async startQrLogin(userId) {
        const correlationId = authCorrelationId();
        logAuthEvent('qr_login_start', { userId, correlationId });
        const existing = this.pending.get(userId);
        if (existing?.method === 'qr' && existing.status === 'waiting' && existing.latestQrUrl) {
            logAuthEvent('qr_login_reuse', { userId, correlationId });
            return {
                qr_url: existing.latestQrUrl,
                expires_at: new Date(existing.expiresAt).toISOString(),
            };
        }
        this.authInFlight.add(userId);
        const tStart = Date.now();
        try {
            await this.disconnectPending(userId, 'start_qr_login');
            const placeholderExpires = new Date(Date.now() + PENDING_DB_TTL_MS).toISOString();
            const { error: holdErr } = await this.supabase.from('telegram_auth_pending').upsert({
                user_id: userId,
                auth_method: 'qr',
                phone: null,
                phone_code_hash: null,
                expires_at: placeholderExpires,
                awaiting_password: false,
                auth_session_string: null,
                qr_expires_at: null,
            }, { onConflict: 'user_id' });
            if (holdErr) {
                logAuthEvent('qr_login_hold_failed', { userId, correlationId, error: holdErr.message });
                console.error('[authService] QR auth hold upsert failed:', holdErr.message);
                throw new Error('Could not start Telegram QR login. Try again in a minute.');
            }
            await this.sessionManager.prepareForAuth(userId);
            const client = (0, telegramClient_1.buildClient)('');
            logAuthEvent('qr_login_connecting', { userId, correlationId });
            await client.connect();
            logAuthEvent('qr_login_connected', { userId, correlationId, connectTimeMs: Date.now() - tStart });
            const pending = {
                method: 'qr',
                client,
                latestQrUrl: '',
                expiresAt: 0,
                status: 'waiting',
                createdAt: Date.now(),
            };
            this.pending.set(userId, pending);
            void this.runQrLoginBackground(userId, pending, correlationId);
            const deadline = Date.now() + QR_FIRST_TOKEN_WAIT_MS;
            while (!pending.latestQrUrl && Date.now() < deadline) {
                await sleep(100);
                if (pending.status === 'error') {
                    logAuthEvent('qr_login_token_error', { userId, correlationId, error: pending.error });
                    console.warn(`[authService] startQrLogin QR error during token wait user=${userId}: ${pending.error}`);
                    throw new Error(pending.error ?? 'Failed to generate QR code');
                }
            }
            if (!pending.latestQrUrl) {
                logAuthEvent('qr_login_token_timeout', { userId, correlationId, waitMs: QR_FIRST_TOKEN_WAIT_MS });
                console.warn(`[authService] startQrLogin no QR token within ${QR_FIRST_TOKEN_WAIT_MS}ms user=${userId}`);
                try {
                    await client.disconnect();
                }
                catch { /* ignore */ }
                this.pending.delete(userId);
                await this.clearPendingRow(userId);
                throw new Error('Failed to generate QR code');
            }
            logAuthEvent('qr_login_token_ready', { userId, correlationId, expiresAt: new Date(pending.expiresAt).toISOString(), totalTimeMs: Date.now() - tStart });
            await this.persistQrPendingRow(userId, client, pending);
            return {
                qr_url: pending.latestQrUrl,
                expires_at: new Date(pending.expiresAt).toISOString(),
            };
        }
        finally {
            this.authInFlight.delete(userId);
        }
    }
    async getQrStatus(userId) {
        const pending = await this.getOrRestoreQrPending(userId);
        if (!pending) {
            // finalizeAuth clears pending before the UI poll observes success — recover from session.
            const { data: sess } = await this.supabase
                .from('telegram_sessions')
                .select('id')
                .eq('user_id', userId)
                .eq('is_active', true)
                .maybeSingle();
            if (sess?.id) {
                logAuthEvent('qr_status_active_session', { userId, sessionId: sess.id });
                return (0, telegramQrAuth_1.qrStatusFromActiveSession)(String(sess.id));
            }
            // startQrLogin upserts a placeholder before the in-memory pending exists; polls
            // during prepareForAuth / connect must not surface "QR login expired".
            if (this.authInFlight.has(userId)) {
                logAuthEvent('qr_status_starting', { userId });
                return { status: 'waiting' };
            }
            const { data: row } = await this.supabase
                .from('telegram_auth_pending')
                .select('auth_method, expires_at')
                .eq('user_id', userId)
                .maybeSingle();
            if (row?.auth_method === 'qr'
                && row.expires_at
                && new Date(row.expires_at).getTime() > Date.now()) {
                logAuthEvent('qr_status_placeholder', { userId });
                return { status: 'waiting' };
            }
            logAuthEvent('qr_status_no_pending', { userId });
            throw new Error('NO_PENDING_QR');
        }
        const status = (0, telegramQrAuth_1.buildQrStatusFromPending)({
            status: pending.status,
            latestQrUrl: pending.latestQrUrl,
            expiresAt: pending.expiresAt,
            error: pending.error,
            result: pending.result,
        });
        logAuthEvent('qr_status', { userId, status: pending.status, error: pending.error ?? 'none', hasResult: !!pending.result });
        return status;
    }
    async verifyQrPassword(userId, password) {
        const correlationId = authCorrelationId();
        logAuthEvent('qr_password_start', { userId, correlationId });
        const pending = await this.getOrRestoreQrPending(userId);
        if (!pending) {
            logAuthEvent('qr_password_no_pending', { userId, correlationId });
            throw new Error('NO_PENDING_QR');
        }
        if (pending.status !== 'requires_password') {
            logAuthEvent('qr_password_wrong_status', { userId, correlationId, status: pending.status });
            throw new Error('QR not awaiting password');
        }
        if (!password?.trim()) {
            throw new Error('Two-step verification password is required');
        }
        const tStart = Date.now();
        const resolver = this.qrPasswordResolvers.get(userId);
        if (resolver) {
            logAuthEvent('qr_password_resolver', { userId, correlationId });
            resolver.resolve(password.trim());
            this.qrPasswordResolvers.delete(userId);
        }
        else {
            logAuthEvent('qr_password_direct', { userId, correlationId });
            await this.completePasswordStep(pending.client, password.trim());
            const me = await pending.client.getMe();
            const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? '';
            pending.status = 'success';
            pending.result = await this.finalizeAuth(pending.client, userId, phone || `tg:${me.id}`, correlationId);
            return pending.result;
        }
        const deadline = Date.now() + QR_PASSWORD_WAIT_MS;
        while (Date.now() < deadline) {
            const current = this.pending.get(userId);
            if (current?.method === 'qr' && current.status === 'success' && current.result) {
                logAuthEvent('qr_password_success', { userId, correlationId, waitMs: Date.now() - tStart });
                return current.result;
            }
            if (current?.method === 'qr' && current.status === 'error') {
                throw new Error(current.error ?? 'QR login failed');
            }
            // finalizeAuth temporarily removes the Map entry — keep waiting (and fall back to
            // an active session) instead of treating that gap as a timeout/failure.
            if (!current || current.method !== 'qr') {
                const { data: sess } = await this.supabase
                    .from('telegram_sessions')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('is_active', true)
                    .maybeSingle();
                if (sess?.id) {
                    logAuthEvent('qr_password_success_via_session', {
                        userId,
                        correlationId,
                        sessionId: sess.id,
                        waitMs: Date.now() - tStart,
                    });
                    return { ok: true, session_id: String(sess.id) };
                }
                await sleep(200);
                continue;
            }
            if (current.status === 'requires_password'
                || current.status === 'waiting'
                || current.status === 'success') {
                await sleep(200);
                continue;
            }
            await sleep(200);
        }
        const { data: sess } = await this.supabase
            .from('telegram_sessions')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();
        if (sess?.id) {
            logAuthEvent('qr_password_success_via_session_after_wait', {
                userId,
                correlationId,
                sessionId: sess.id,
            });
            return { ok: true, session_id: String(sess.id) };
        }
        throw new Error('QR login timed out');
    }
}
exports.AuthService = AuthService;
