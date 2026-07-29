import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  dispatchPriorityForAction,
  isEntryAction,
  isManagementAction,
  signalMatchesExecutorMode,
} from './tradeSignalActions'

describe('tradeSignalActions', () => {
  test('isEntryAction', () => {
    assert.equal(isEntryAction('buy'), true)
    assert.equal(isEntryAction('modify'), false)
  })

  test('signalMatchesExecutorMode entry vs mgmt', () => {
    assert.equal(signalMatchesExecutorMode({ action: 'buy' }, 'entry'), true)
    assert.equal(signalMatchesExecutorMode({ action: 'buy' }, 'mgmt'), false)
    assert.equal(signalMatchesExecutorMode({ action: 'close' }, 'mgmt'), true)
    assert.equal(signalMatchesExecutorMode({ action: 'close' }, 'entry'), false)
    assert.equal(signalMatchesExecutorMode({ action: 'delete_pendings' }, 'mgmt'), true)
    assert.equal(signalMatchesExecutorMode({ action: 'delete_pendings' }, 'entry'), false)
  })

  test('isManagementAction includes delete_pendings', () => {
    assert.equal(isManagementAction('delete_pendings'), true)
    assert.equal(isManagementAction('modify'), true)
    assert.equal(isManagementAction('buy'), false)
  })

  test('dispatchPriorityForAction', () => {
    assert.equal(dispatchPriorityForAction('sell'), 'high')
    assert.equal(dispatchPriorityForAction('modify'), 'high')
    assert.equal(dispatchPriorityForAction('close_worse_entries'), 'high')
    assert.equal(dispatchPriorityForAction('close'), 'high')
    assert.equal(dispatchPriorityForAction('breakeven'), 'normal')
  })
})
