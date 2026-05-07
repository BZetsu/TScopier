"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const tl_1 = require("telegram/tl");
const Password_1 = require("telegram/Password");
const telegramClient_1 = require("./telegramClient");
/**
 * Maximum age of a pending auth (between send_code and verify_code)
 * before we drop the client. Telegram's own code expiration is ~5 min.
 */
const PENDING_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
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
    }
    cleanup() {
        const now = Date.now();
        for (const [userId, p] of this.pending) {
            if (now - p.createdAt > PENDING_TTL_MS) {
                p.client.disconnect().catch(() => { });
                this.pending.delete(userId);
                console.log(`[authService] expired pending auth for user ${userId}`);
            }
        }
    }
    async sendCode(userId, phone) {
        const existing = this.pending.get(userId);
        if (existing) {
            try {
                await existing.client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
        }
        const client = (0, telegramClient_1.buildClient)('');
        await client.connect();
        try {
            const result = await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SendCode({
                phoneNumber: phone,
                apiId: telegramClient_1.API_ID,
                apiHash: telegramClient_1.API_HASH,
                settings: new tl_1.Api.CodeSettings({
                    allowFlashcall: false,
                    currentNumber: true,
                    allowAppHash: true,
                }),
            }));
            this.pending.set(userId, {
                client,
                phone,
                phoneCodeHash: result.phoneCodeHash,
                createdAt: Date.now(),
            });
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
    async verifyCode(userId, code, password) {
        const pending = this.pending.get(userId);
        if (!pending) {
            throw new Error('No pending auth flow. Call send_code first.');
        }
        const { client, phone, phoneCodeHash } = pending;
        try {
            if (password) {
                // Code path 2: user re-submitted with password after first attempt asked for it.
                try {
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: phone,
                        phoneCodeHash,
                        phoneCode: code,
                    }));
                }
                catch (signInErr) {
                    const msg = signInErr instanceof Error ? signInErr.message : String(signInErr);
                    if (!msg.includes('SESSION_PASSWORD_NEEDED'))
                        throw signInErr;
                }
                const srpResult = await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.account.GetPassword());
                const srpCheck = await (0, Password_1.computeCheck)(srpResult, password);
                await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.CheckPassword({ password: srpCheck }));
            }
            else {
                try {
                    await (0, telegramClient_1.tgInvoke)(client, new tl_1.Api.auth.SignIn({
                        phoneNumber: phone,
                        phoneCodeHash,
                        phoneCode: code,
                    }));
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
                        // Keep the pending client alive — frontend will resend with password.
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
            throw err;
        }
        const sessionString = client.session.save();
        const { data: row, error: dbErr } = await this.supabase
            .from('telegram_sessions')
            .upsert({
            user_id: userId,
            session_string: sessionString,
            phone_number: phone,
            is_active: true,
        }, { onConflict: 'user_id' })
            .select('id')
            .single();
        if (dbErr || !row) {
            try {
                await client.disconnect();
            }
            catch { /* ignore */ }
            this.pending.delete(userId);
            throw new Error(dbErr?.message ?? 'Failed to persist Telegram session');
        }
        // Hand the *live* authenticated client to the session manager so it
        // becomes the long-running listener — no second connect from this host.
        this.pending.delete(userId);
        try {
            await this.sessionManager.adoptClient(userId, client, sessionString);
        }
        catch (err) {
            console.error(`[authService] adoptClient failed for ${userId}:`, err);
            // Session is persisted; manager will pick it up on next syncSessions tick.
        }
        return { ok: true, session_id: row.id };
    }
}
exports.AuthService = AuthService;
