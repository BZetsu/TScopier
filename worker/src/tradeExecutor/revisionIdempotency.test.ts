import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  revisionRefreshSafeSkipOutcome,
  revisionRefreshWithoutOpenBasketOutcome,
} from './basketMerge/mergeRouting'
import { claimSignalBrokerDispatch } from './signalBrokerDispatchClaim'

describe('message revision idempotency policy', () => {
  it('marks every revision without a modifiable basket as handled and safe to skip', () => {
    assert.deepEqual(revisionRefreshSafeSkipOutcome(), { handled: true, success: false })
    assert.deepEqual(revisionRefreshWithoutOpenBasketOutcome(true), { handled: true, success: false })
  })

  it('does not treat a normal parameter follow-up without a basket as a revision', () => {
    assert.deepEqual(revisionRefreshWithoutOpenBasketOutcome(false), { handled: false })
  })

  it('fails closed when the claim insert cannot be confirmed', async () => {
    const client = {
      from: () => ({
        insert: async () => ({ error: { code: '08006', message: 'database unavailable' } }),
      }),
    }
    const claimed = await claimSignalBrokerDispatch(
      client as never,
      'signal-id',
      'broker-id',
    )
    assert.equal(claimed, false)
  })
})
