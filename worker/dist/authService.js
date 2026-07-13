"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const tl_1 = require("telegram/tl");
const Password_1 = require("telegram/Password");
const telegramClient_1 = require("./telegramClient");
const telegramAccountClaims_1 = require("./telegramAccountClaims");
const telegramQrAuth_1 = require("./telegramQrAuth");
/**
 * Maximum age of a pending auth (between send_code and verify_code)
 * before we drop the in-memory client. Telegram codes expire in a few minutes;
 * DB-backed recovery lasts slightly longer for cross-replica / slow UX.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
/** DB row outlives Telegram code validity slightly so retries still recover across replicas. */
const PENDING_DB_TTL_MS = 12 * 60 * 1000;
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
        this.qrPasswordResolvers = new Map();
        this.sessionManager.setAuthGuard(userId => this.pending.has(userId));
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        if (typeof this.cleanupTimer.unref === 'function')
            this.cleanupTimer.unref();
    }
    shutdown() {
        clearInterval(this.cleanupTimer);
        for (const [, p] of this.pending) {
            p.client.disconnect().catch(() => { });
        }
        this.pending.clear();
        this.qrPasswordResolvers.clear();
    }
    cleanup() {
        const now = Date.now();
        for (const [userId, p] of this.pending) {
            if (now - p.createdAt > PENDING_TTL_MS) {
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
    async clearPendingRow(userId) {
        await this.supabase.from('telegram_auth_pending').delete().eq('user_id', userId);
    }
    async disconnectPending(userId) {
        const existing = this.pending.get(userId);
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
        if (row.auth_method === 'qr')
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
        const savedSession = awaitingPassword && typeof row.auth_session_string === 'string' && row.auth_session_string.trim()
            ? row.auth_session_string.trim()
            : '';
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
    async persistAwaitingPassword(userId, client) {
        const authSessionString = client.session.save();
        const { error } = await this.supabase
            .from('telegram_auth_pending')
            .update({
            awaiting_password: true,
            auth_session_string: authSessionString,
        })
            .eq('user_id', userId);
        if (error) {
            console.warn(`[authService] persistAwaitingPassword failed for ${userId}:`, error.message);
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
    async finalizeAuth(client, userId, phone) {
        const sessionString = client.session.save();
        const me = await client.getMe();
        const telegramUserId = me.id?.toString?.() ?? String(me.id);
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
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            await this.clearPendingRow(userId);
            throw new Error(dbErr?.message ?? 'Failed to persist Telegram session');
        }
        try {
            await (0, telegramAccountClaims_1.upsertTelegramAccountClaim)(this.supabase, userId, {
                phone,
                telegramUserId,
            });
        }
        catch (claimErr) {
            await this.supabase.from('telegram_sessions').delete().eq('user_id', userId);
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            await this.clearPendingRow(userId);
            throw claimErr;
        }
        this.pending.delete(userId);
        await this.clearPendingRow(userId);
        let channels;
        try {
            await this.sessionManager.adoptClient(userId, client, sessionString);
            try {
                channels = await this.sessionManager.listChannelsForAdoptedUser(userId, { skipColdDelay: true });
            }
            catch (listErr) {
                console.warn(`[authService] listChannels after auth failed for ${userId}:`, listErr);
            }
        }
        catch (err) {
            console.error(`[authService] adoptClient failed for ${userId}:`, err);
            try {
                await client.disconnect();
            }
            catch {
                /* ignore */
            }
        }
        return { ok: true, session_id: row.id, channels };
    }
    async runQrLoginBackground(userId, pending) {
        const { client } = pending;
        try {
            await client.signInUserWithQrCode({ apiId: telegramClient_1.API_ID, apiHash: telegramClient_1.API_HASH }, {
                qrCode: async ({ token, expires }) => {
                    pending.latestQrUrl = (0, telegramQrAuth_1.formatQrLoginUrl)(Buffer.isBuffer(token) ? token : Buffer.from(token));
                    pending.expiresAt = expires * 1000;
                    await this.persistQrPendingRow(userId, client, pending);
                },
                password: async (hint) => {
                    pending.status = 'requires_password';
                    pending.passwordHint = hint;
                    await this.persistAwaitingPassword(userId, client);
                    return new Promise((resolve, reject) => {
                        this.qrPasswordResolvers.set(userId, { resolve, reject });
                    });
                },
                onError: async (err) => {
                    console.warn(`[authService] QR login onError user=${userId}:`, err.message);
                    return false;
                },
            });
            const me = await client.getMe();
            const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? '';
            pending.phone = phone;
            pending.status = 'success';
            pending.result = await this.finalizeAuth(client, userId, phone || `tg:${me.id}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pending.status = 'error';
            pending.error = msg;
            console.error(`[authService] QR login failed user=${userId}:`, msg);
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
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
        const normalizedPhone = normalizePhoneNumber(phone);
        if (!normalizedPhone || !normalizedPhone.startsWith('+')) {
            throw new Error('Use full phone with country code, e.g. +44...');
        }
        await (0, telegramAccountClaims_1.assertTelegramAccountAvailable)(this.supabase, userId, { phone: normalizedPhone });
        await this.sessionManager.pauseForAuth(userId);
        await this.disconnectPending(userId);
        await this.clearPendingRow(userId);
        const client = (0, telegramClient_1.buildClient)('');
        await client.connect();
        try {
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
            }, { onConflict: 'user_id' });
            if (dbErr) {
                console.error('[authService] telegram_auth_pending upsert:', dbErr.message);
            }
            return { phone_code_hash: result.phoneCodeHash };
        }
        catch (err) {
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            throw err;
        }
    }
    async verifyCode(userId, phone, code, password) {
        const normalizedPhone = normalizePhoneNumber(phone);
        const normalizedCode = normalizeVerificationCode(code);
        if (!normalizedCode) {
            throw new Error('Verification code is required');
        }
        await this.sessionManager.pauseForAuth(userId, { releaseDelay: false });
        let pending;
        const mem = this.pending.get(userId);
        if (mem?.method === 'phone')
            pending = mem;
        if (!pending) {
            const restored = await this.restorePhonePendingFromDatabase(userId, normalizedPhone);
            if (restored) {
                pending = restored;
                this.pending.set(userId, restored);
            }
        }
        if (!pending) {
            throw new Error('No pending auth flow. Call send_code first.');
        }
        const { client, phone: pendingPhone, phoneCodeHash } = pending;
        try {
            if (pending.awaitingPassword) {
                if (!password?.trim()) {
                    throw new Error('Two-step verification password is required');
                }
                await this.completePasswordStep(client, password.trim());
            }
            else if (password?.trim()) {
                try {
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: pendingPhone,
                        phoneCodeHash,
                        phoneCode: normalizedCode,
                    }));
                }
                catch (signInErr) {
                    const msg = signInErr instanceof Error ? signInErr.message : String(signInErr);
                    if (!msg.includes('SESSION_PASSWORD_NEEDED'))
                        throw signInErr;
                    pending.awaitingPassword = true;
                    await this.persistAwaitingPassword(userId, client);
                    await this.completePasswordStep(client, password.trim());
                }
            }
            else {
                try {
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: pendingPhone,
                        phoneCodeHash,
                        phoneCode: normalizedCode,
                    }));
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
                        pending.awaitingPassword = true;
                        await this.persistAwaitingPassword(userId, client);
                        return { requires_password: true };
                    }
                    throw err;
                }
            }
        }
        catch (err) {
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            await this.clearPendingRow(userId);
            throw err;
        }
        return this.finalizeAuth(client, userId, pendingPhone);
    }
    async startQrLogin(userId) {
        await this.sessionManager.pauseForAuth(userId);
        const existing = this.pending.get(userId);
        if (existing?.method === 'qr' && existing.status === 'waiting' && existing.latestQrUrl) {
            return {
                qr_url: existing.latestQrUrl,
                expires_at: new Date(existing.expiresAt).toISOString(),
            };
        }
        await this.disconnectPending(userId);
        await this.clearPendingRow(userId);
        const client = (0, telegramClient_1.buildClient)('');
        await client.connect();
        const pending = {
            method: 'qr',
            client,
            latestQrUrl: '',
            expiresAt: 0,
            status: 'waiting',
            createdAt: Date.now(),
        };
        this.pending.set(userId, pending);
        void this.runQrLoginBackground(userId, pending);
        const deadline = Date.now() + QR_FIRST_TOKEN_WAIT_MS;
        while (!pending.latestQrUrl && Date.now() < deadline) {
            await sleep(100);
            if (pending.status === 'error') {
                throw new Error(pending.error ?? 'Failed to generate QR code');
            }
        }
        if (!pending.latestQrUrl) {
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            throw new Error('Failed to generate QR code');
        }
        await this.persistQrPendingRow(userId, client, pending);
        return {
            qr_url: pending.latestQrUrl,
            expires_at: new Date(pending.expiresAt).toISOString(),
        };
    }
    async getQrStatus(userId) {
        const pending = await this.getOrRestoreQrPending(userId);
        if (!pending) {
            throw new Error('NO_PENDING_QR');
        }
        return (0, telegramQrAuth_1.buildQrStatusFromPending)({
            status: pending.status,
            latestQrUrl: pending.latestQrUrl,
            expiresAt: pending.expiresAt,
            error: pending.error,
            result: pending.result,
        });
    }
    async verifyQrPassword(userId, password) {
        const pending = await this.getOrRestoreQrPending(userId);
        if (!pending) {
            throw new Error('NO_PENDING_QR');
        }
        if (pending.status !== 'requires_password') {
            throw new Error('QR not awaiting password');
        }
        if (!password?.trim()) {
            throw new Error('Two-step verification password is required');
        }
        const resolver = this.qrPasswordResolvers.get(userId);
        if (resolver) {
            resolver.resolve(password.trim());
            this.qrPasswordResolvers.delete(userId);
        }
        else {
            await this.completePasswordStep(pending.client, password.trim());
            const me = await pending.client.getMe();
            const phone = me.phone ? normalizePhoneNumber(`+${me.phone}`) : pending.phone ?? '';
            pending.status = 'success';
            pending.result = await this.finalizeAuth(pending.client, userId, phone || `tg:${me.id}`);
            return pending.result;
        }
        const deadline = Date.now() + QR_PASSWORD_WAIT_MS;
        while (Date.now() < deadline) {
            const current = this.pending.get(userId);
            if (current?.method === 'qr' && current.status === 'success' && current.result) {
                return current.result;
            }
            if (current?.method === 'qr' && current.status === 'error') {
                throw new Error(current.error ?? 'QR login failed');
            }
            if (current?.method !== 'qr' || current.status !== 'requires_password') {
                break;
            }
            await sleep(200);
        }
        throw new Error('QR login timed out');
    }
}
exports.AuthService = AuthService;
