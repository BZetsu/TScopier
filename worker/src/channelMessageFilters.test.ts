import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  filterKeysForManagementAction,
  isChannelManagementBlocked,
  normalizeChannelFilters,
} from './channelMessageFilters'

test('close action blocked when close_full is ignore', () => {
  const filters = { ch1: normalizeChannelFilters({ close_full: 'ignore' }) }
  assert.equal(isChannelManagementBlocked(filters, 'ch1', 'close'), true)
})

test('close action blocked when close_all is ignore', () => {
  const filters = { ch1: normalizeChannelFilters({ close_all: 'ignore' }) }
  assert.equal(isChannelManagementBlocked(filters, 'ch1', 'close'), true)
})

test('close action allowed when only close_half is ignore', () => {
  const filters = { ch1: normalizeChannelFilters({ close_half: 'ignore' }) }
  assert.equal(isChannelManagementBlocked(filters, 'ch1', 'close'), false)
})

test('close_worse_entries respects its own filter', () => {
  const filters = { ch1: normalizeChannelFilters({ close_worse_entries: 'ignore' }) }
  assert.equal(isChannelManagementBlocked(filters, 'ch1', 'close_worse_entries'), true)
  assert.equal(isChannelManagementBlocked(filters, 'ch1', 'close'), false)
})

test('modify checks sl/tp separately', () => {
  const filters = { ch1: normalizeChannelFilters({ modify_sl: 'ignore' }) }
  assert.equal(
    isChannelManagementBlocked(filters, 'ch1', 'modify', { hasNewSl: true, hasNewTp: false }),
    true,
  )
  assert.equal(
    isChannelManagementBlocked(filters, 'ch1', 'modify', { hasNewSl: false, hasNewTp: true }),
    false,
  )
})

test('filterKeysForManagementAction: close maps to full-close categories', () => {
  assert.deepEqual(filterKeysForManagementAction('close'), ['close_full', 'close_all'])
})
