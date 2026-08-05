"use strict";
/**
 * Helpers for AUTH_KEY_DUPLICATED recovery (same Telegram session online twice).
 * Keeps poll_error spam down and spaces reconnect attempts while the old TCP dies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEmitAuthKeyDupEvent = shouldEmitAuthKeyDupEvent;
exports.authKeyDupReconnectDelaysMs = authKeyDupReconnectDelaysMs;
exports.authKeyDupReconnectDelayMs = authKeyDupReconnectDelayMs;
exports.authKeyDupMaxRecoveryAttempts = authKeyDupMaxRecoveryAttempts;
exports.authKeyDupDeferredRetryMs = authKeyDupDeferredRetryMs;
exports.redactTelegramConnectionLog = redactTelegramConnectionLog;
/** True when enough time has passed since the last persisted/logged dup event. */
function shouldEmitAuthKeyDupEvent(lastEmittedAtMs, nowMs = Date.now(), minIntervalMs = 60000) {
    const interval = Math.max(5000, minIntervalMs);
    return !Number.isFinite(lastEmittedAtMs) || lastEmittedAtMs <= 0 || nowMs - lastEmittedAtMs >= interval;
}
/**
 * Backoff delays (ms) before each connect attempt during AUTH_KEY_DUPLICATED recovery.
 * First delay is the normal reconnect cooldown; later delays escalate so Telegram gets
 * time to release the prior connection. Default: [cooldown, retry, 15s, 30s, 30s, 30s, ...]
 */
function authKeyDupReconnectDelaysMs(initialCooldownMs, authDupDelayMs = authKeyDupReconnectDelayMs(), maxAttempts = authKeyDupMaxRecoveryAttempts()) {
    const first = Math.max(500, Math.min(120000, initialCooldownMs));
    const retry = Math.max(2000, Math.min(120000, authDupDelayMs));
    const attempts = Math.max(1, Math.min(100, Math.floor(maxAttempts)));
    const slots = [retry, 15000, 30000];
    return Array.from({ length: attempts }, (_, i) => {
        if (i === 0)
            return first;
        return slots[i - 1] ?? 30000;
    });
}
/** Delay between AUTH_KEY_DUPLICATED recovery connect attempts. */
function authKeyDupReconnectDelayMs() {
    return Math.max(2000, Math.min(120000, Number(process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS ?? 30000)));
}
/** Maximum connect cycles before requiring the user to re-link Telegram. */
function authKeyDupMaxRecoveryAttempts() {
    return Math.max(1, Math.min(100, Math.floor(Number(process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS ?? 4))));
}
/** Schedule another reconnect attempt after forceReconnect exhausts retries. */
function authKeyDupDeferredRetryMs() {
    return Math.max(15000, Math.min(300000, Number(process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS ?? 60000)));
}
function redactTelegramConnectionLog(value) {
    const raw = value instanceof Error ? value.message : String(value ?? '');
    return raw
        .replace(/[A-Za-z0-9+/=]{80,}/g, '[redacted]')
        .replace(/\b\d{8,15}\b/g, '[redacted]');
}
