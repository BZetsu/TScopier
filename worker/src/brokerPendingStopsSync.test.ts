import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { brokerPendingRowNeedsStopSync } from './brokerPendingStopsSync'

describe('brokerPendingStopsSync', () => {
  it('brokerPendingRowNeedsStopSync requires ticket and at least one stop', () => {
    assert.equal(
      brokerPendingRowNeedsStopSync({ ticket: '1', stoploss: 4118, takeprofit: null }),
      true,
    )
    assert.equal(
      brokerPendingRowNeedsStopSync({ ticket: '1', stoploss: null, takeprofit: 4088 }),
      true,
    )
    assert.equal(
      brokerPendingRowNeedsStopSync({ ticket: '1', stoploss: null, takeprofit: null }),
      false,
    )
    assert.equal(
      brokerPendingRowNeedsStopSync({ ticket: null, stoploss: 4118, takeprofit: 4088 }),
      false,
    )
  })
})
