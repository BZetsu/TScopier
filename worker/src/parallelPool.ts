/** Bounded-concurrency async map for multi-leg management (CWE, close, modify). */

export function mgmtLegConcurrency(): number {
  return Math.max(1, Math.min(16, Number(process.env.MGMT_LEG_CONCURRENCY ?? 8)))
}

/**
 * Concurrency for applying management across distinct baskets (accounts) at once.
 * Each basket targets a different MT terminal, so this is bounded separately from
 * per-leg concurrency (which shares one terminal). Default 6 — tuned for 10-15
 * accounts copying a management-heavy channel (e.g. GTMO VIP).
 */
export function mgmtBasketConcurrency(): number {
  return Math.max(1, Math.min(16, Number(process.env.MGMT_BASKET_CONCURRENCY ?? 6)))
}

/**
 * Post-OrderModify broker re-read/verification. Off by default for speed — the
 * basket reconcile monitor (broker-drift check) re-verifies and re-applies, so
 * inline per-leg verification is not required for correctness.
 */
export function mgmtVerifyAfterModify(): boolean {
  const v = String(process.env.MGMT_VERIFY_AFTER_MODIFY ?? 'false').toLowerCase().trim()
  return v === '1' || v === 'true' || v === 'yes'
}

export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
