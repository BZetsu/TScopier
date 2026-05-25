import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  looksLikeChannelManagementUpdate,
  partialCloseFractionFromMessage,
} from './signalManagementIntent'

test('looksLikeChannelManagementUpdate: partial lotsize close', () => {
  assert.equal(
    looksLikeChannelManagementUpdate('Make sure to secure 30% profits by closing partial lotsize'),
    true,
  )
})

test('looksLikeChannelManagementUpdate: move stop to breakeven', () => {
  assert.equal(
    looksLikeChannelManagementUpdate('+50 pips running, you can move stop to breakeven.'),
    true,
  )
})

test('partialCloseFractionFromMessage: secure 30% profits', () => {
  assert.equal(
    partialCloseFractionFromMessage('secure 30% profits by closing partial lotsize'),
    0.3,
  )
})
