import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  computeTodaysProfit,
  isTimestampInRange,
  netClosedLegProfit,
  sumTradeableClosedProfitInRange,
} from './dashboardTradeStats'

test('computeTodaysProfit: adds realized and live open P/L', () => {
  assert.equal(computeTodaysProfit(120, 45), 165)
  assert.equal(computeTodaysProfit(-50, -10), -60)
  assert.equal(computeTodaysProfit(100, null), 100)
})

test('sumTradeableClosedProfitInRange: includes swap and commission', () => {
  const rows = [
    {
      status: 'closed',
      symbol: 'XAUUSD',
      lot_size: 0.01,
      direction: 'buy',
      profit: 10,
      closed_at: '2026-05-16T12:00:00.000Z',
      swap: -1,
      commission: -0.5,
    },
  ]
  const sum = sumTradeableClosedProfitInRange(rows, () => true)
  assert.equal(sum, netClosedLegProfit(rows[0]!))
  assert.equal(sum, 8.5)
})

test('isTimestampInRange: half-open interval', () => {
  const start = new Date('2026-05-16T00:00:00.000Z')
  const end = new Date('2026-05-17T00:00:00.000Z')
  assert.equal(isTimestampInRange('2026-05-16T23:59:59.000Z', start, end), true)
  assert.equal(isTimestampInRange('2026-05-17T00:00:00.000Z', start, end), false)
})
