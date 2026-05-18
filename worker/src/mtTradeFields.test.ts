import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mergeMtHistoryRow, resolveMtDealProfit, resolveMtLots } from './mtTradeFields.js'

test('resolveMtLots: MT5 integer volume and explicit lots', () => {
  assert.equal(resolveMtLots({ volume: 100 }), 0.01)
  assert.equal(resolveMtLots({ Volume: 10000 }), 1)
  assert.equal(resolveMtLots({ lots: 0.05 }), 0.05)
  assert.equal(resolveMtLots({ volume: 0.05 }), 0.05)
})

test('mergeMtHistoryRow: keeps deal profit and lots when position snapshot is sparse', () => {
  const deal = { ticket: 123, lots: 0.1, profit: 42.5, closeTime: '2026-05-18T10:00:00' }
  const position = { ticket: 123, volume: 0, profit: 0, closeTime: '2026-05-18T10:00:00' }
  const merged = mergeMtHistoryRow(deal, position)
  assert.equal(resolveMtLots(merged), 0.1)
  assert.equal(resolveMtDealProfit(merged), 42.5)
})
