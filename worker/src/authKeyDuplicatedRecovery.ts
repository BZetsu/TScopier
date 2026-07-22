/**
 * Helpers for AUTH_KEY_DUPLICATED recovery (same Telegram session online twice).
 * Keeps poll_error spam down and spaces reconnect attempts while the old TCP dies.
 */

/** True when enough time has passed since the last persisted/logged dup event. */
export function shouldEmitAuthKeyDupEvent(
  lastEmittedAtMs: number,
  nowMs = Date.now(),
  minIntervalMs = 60_000,
): boolean {
  const interval = Math.max(5_000, minIntervalMs)
  return !Number.isFinite(lastEmittedAtMs) || lastEmittedAtMs <= 0 || nowMs - lastEmittedAtMs >= interval
}

/**
 * Backoff delays (ms) before each connect attempt during AUTH_KEY_DUPLICATED recovery.
 * First delay is the normal reconnect cooldown; later delays give Telegram time to
 * release the prior connection after deploy overlap / double connect.
 */
export function authKeyDupReconnectDelaysMs(
  initialCooldownMs: number,
  authDupDelayMs: number,
): number[] {
  const first = Math.max(500, Math.min(120_000, initialCooldownMs))
  const second = Math.max(2_000, Math.min(60_000, authDupDelayMs))
  return [first, second, 15_000, 30_000]
}

/** Schedule another reconnect attempt after forceReconnect exhausts retries. */
export function authKeyDupDeferredRetryMs(): number {
  return Math.max(
    15_000,
    Math.min(300_000, Number(process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS ?? 60_000)),
  )
}
