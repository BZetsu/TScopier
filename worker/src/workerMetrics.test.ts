import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getMetricsSnapshot, observeMetric } from './workerMetrics'

describe('worker metric observations', () => {
  it('records cumulative latency buckets with count and sum', () => {
    const name = `test_latency_${Date.now()}`
    observeMetric(name, 75, [50, 100, 250])

    const metrics = getMetricsSnapshot()
    assert.equal(metrics[`${name}_count`], 1)
    assert.equal(metrics[`${name}_sum`], 75)
    assert.equal(metrics[`${name}_bucket_le_50`], undefined)
    assert.equal(metrics[`${name}_bucket_le_100`], 1)
    assert.equal(metrics[`${name}_bucket_le_250`], 1)
    assert.equal(metrics[`${name}_bucket_le_+Inf`], 1)
  })

  it('ignores invalid observations', () => {
    const name = `test_invalid_latency_${Date.now()}`
    observeMetric(name, -1, [50])
    observeMetric(name, Number.NaN, [50])

    const metrics = getMetricsSnapshot()
    assert.equal(metrics[`${name}_count`], undefined)
    assert.equal(metrics[`${name}_bucket_le_+Inf`], undefined)
  })
})
