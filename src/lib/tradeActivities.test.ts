import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  shouldRefreshActivitiesOnRealtimePayload,
  tradeActivityLogsFingerprint,
} from './tradeActivities'

test('shouldRefreshActivitiesOnRealtimePayload: ignores hidden internal ticks', () => {
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'basket_reconcile_tick' }), false)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'queue_consume_ack' }), false)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'merge_routed_modify_only' }), false)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'news_pre_close' }), false)
})

test('shouldRefreshActivitiesOnRealtimePayload: refreshes visible copier activity', () => {
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'order_send' }), true)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'auto_be' }), true)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'mgmt_modify' }), true)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({ action: 'AUTO_BE' }), true)
})

test('shouldRefreshActivitiesOnRealtimePayload: refreshes when action is missing', () => {
  assert.equal(shouldRefreshActivitiesOnRealtimePayload({}), true)
  assert.equal(shouldRefreshActivitiesOnRealtimePayload(null), true)
})

test('tradeActivityLogsFingerprint: identical newest/count skips a React rewrite', () => {
  const a = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const b = [{ id: '1' }, { id: '2' }, { id: '3' }]
  assert.equal(tradeActivityLogsFingerprint(a), tradeActivityLogsFingerprint(b))
})

test('tradeActivityLogsFingerprint: new row or count change is a different snapshot', () => {
  const prev = tradeActivityLogsFingerprint([{ id: '1' }, { id: '2' }])
  const newer = tradeActivityLogsFingerprint([{ id: '0' }, { id: '1' }, { id: '2' }])
  const swapped = tradeActivityLogsFingerprint([{ id: '9' }, { id: '2' }])
  assert.notEqual(prev, newer)
  assert.notEqual(prev, swapped)
  assert.equal(tradeActivityLogsFingerprint([]), '0')
})
