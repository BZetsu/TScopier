/** Lightweight in-process counters for logs and /health (no external metrics stack required). */

const counters = new Map<string, number>()

export function incMetric(name: string, delta = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + delta)
}

const DEFAULT_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000]

export function observeMetric(name: string, value: number, buckets = DEFAULT_BUCKETS_MS): void {
  if (!Number.isFinite(value) || value < 0) return
  incMetric(`${name}_count`)
  incMetric(`${name}_sum`, value)
  for (const upper of buckets) {
    if (value <= upper) {
      incMetric(`${name}_bucket_le_${upper}`)
    }
  }
  incMetric(`${name}_bucket_le_+Inf`)
}

export function getMetricsSnapshot(): Record<string, number> {
  return Object.fromEntries(counters.entries())
}
