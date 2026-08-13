/**
 * Retry an async operation (e.g. a signal parse) a bounded number of times on
 * failure, with caller-provided backoff. Used around parse-only work — retrying
 * is safe there because nothing has been persisted or sent to the broker yet.
 */

export type WithParseRetryOptions<T> = {
  /** The operation to run. attemptIndex is 0-based (0 = first attempt). */
  attempt: (attemptIndex: number) => Promise<T>
  /** Total attempts including the first (must be >= 1). */
  maxAttempts: number
  /** Backoff milliseconds to wait after attempt attemptIndex fails. */
  backoffMs: (attemptIndex: number) => number
  /** Called before each retry (after the failure, before the backoff sleep). */
  onRetry?: (err: unknown, attemptIndex: number) => void
}

export async function withParseRetry<T>(opts: WithParseRetryOptions<T>): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts))
  let lastErr: unknown
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    try {
      return await opts.attempt(attemptIndex)
    } catch (err) {
      lastErr = err
      if (attemptIndex < maxAttempts - 1) {
        opts.onRetry?.(err, attemptIndex)
        const delayMs = opts.backoffMs(attemptIndex)
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
