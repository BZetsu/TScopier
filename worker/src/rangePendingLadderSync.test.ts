import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  consumedStepIndices,
  maxConsumedStepIndex,
} from './rangePendingLadderSync'

describe('consumedStepIndices', () => {
  it('includes fired and expired, not pending', () => {
    const s = consumedStepIndices([
      { id: '1', step_idx: 1, status: 'fired', stoploss: null, takeprofit: null },
      { id: '2', step_idx: 2, status: 'pending', stoploss: null, takeprofit: null },
      { id: '3', step_idx: 3, status: 'expired', stoploss: null, takeprofit: null },
    ])
    assert.deepEqual([...s].sort(), [1, 3])
  })
})

describe('maxConsumedStepIndex', () => {
  it('returns highest consumed step', () => {
    assert.equal(maxConsumedStepIndex(new Set([1, 4, 2])), 4)
    assert.equal(maxConsumedStepIndex(new Set()), 0)
  })
})
