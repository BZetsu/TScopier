"use strict";
/**
 * Helpers for AUTH_KEY_DUPLICATED recovery (same Telegram session online twice).
 * Keeps poll_error spam down and spaces reconnect attempts while the old TCP dies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEmitAuthKeyDupEvent = shouldEmitAuthKeyDupEvent;
exports.authKeyDupReconnectDelaysMs = authKeyDupReconnectDelaysMs;
exports.authKeyDupDeferredRetryMs = authKeyDupDeferredRetryMs;
/** True when enough time has passed since the last persisted/logged dup event. */
function shouldEmitAuthKeyDupEvent(lastEmittedAtMs, nowMs = Date.now(), minIntervalMs = 60000) {
    const interval = Math.max(5000, minIntervalMs);
    return !Number.isFinite(lastEmittedAtMs) || lastEmittedAtMs <= 0 || nowMs - lastEmittedAtMs >= interval;
}
/**
 * Backoff delays (ms) before each connect attempt during AUTH_KEY_DUPLICATED recovery.
 * First delay is the normal reconnect cooldown; later delays give Telegram time to
 * release the prior connection after deploy overlap / double connect.
 */
function authKeyDupReconnectDelaysMs(initialCooldownMs, authDupDelayMs) {
    const first = Math.max(500, Math.min(120000, initialCooldownMs));
    const second = Math.max(2000, Math.min(60000, authDupDelayMs));
    return [first, second, 15000, 30000];
}
/** Schedule another reconnect attempt after forceReconnect exhausts retries. */
function authKeyDupDeferredRetryMs() {
    return Math.max(15000, Math.min(300000, Number(process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS ?? 60000)));
}
