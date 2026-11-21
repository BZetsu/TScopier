import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAccountTradesCsv,
  dayBoundsForKey,
  filterMtTradesForExportDay,
  resolveExportDayKey,
} from './accountTradesCsvCore'
import type { MtTrade } from './fxsocketBroker'

function trade(partial: Partial<MtTrade> & Pick<MtTrade, 'id' | 'opened_at'>): MtTrade {
  return {
    broker_id: 'b1',
    broker_label: 'Demo',
    broker_name: null,
    ticket: 1,
    symbol: 'EURUSD',
    direction: 'buy',
    type: 'Buy',
    lot_size: 0.1,
    entry_price: 1.1,
    sl: null,
    tp: null,
    close_price: null,
    profit: 10,
    swap: 0,
    commission: 0,
    comment: null,
    magic: null,
    closed_at: null,
    state: null,
    status: 'open',
    ...partial,
  }
}

describe('accountTradesCsv', () => {
  it('resolves today and YYYY-MM-DD day keys', () => {
    const ref = new Date(2026, 10, 14, 15, 0, 0)
    assert.equal(resolveExportDayKey('today', ref), '2026-11-14')
    assert.equal(resolveExportDayKey('2026-11-13', ref), '2026-11-13')
    assert.equal(resolveExportDayKey('nope', ref), '2026-11-14')
  })

  it('filters trades opened on the local day', () => {
    const day = '2026-11-14'
    const { start, end } = dayBoundsForKey(day)
    const rows = [
      trade({ id: 'a', opened_at: new Date(start.getTime() + 3600_000).toISOString(), ticket: 11 }),
      trade({ id: 'b', opened_at: new Date(end.getTime()).toISOString(), ticket: 12 }),
      trade({ id: 'c', opened_at: new Date(start.getTime() - 1000).toISOString(), ticket: 13 }),
      trade({
        id: 'd',
        opened_at: new Date(start.getTime() + 7200_000).toISOString(),
        ticket: 14,
        broker_id: 'other',
      }),
    ]
    const filtered = filterMtTradesForExportDay(rows, day, 'b1')
    assert.deepEqual(
      filtered.map(t => t.id),
      ['a'],
    )
  })

  it('builds a CSV with header and BOM', () => {
    const csv = buildAccountTradesCsv([
      trade({
        id: 'a',
        opened_at: '2026-11-14T10:00:00.000Z',
        ticket: 42,
        comment: 'hello, world',
      }),
    ])
    assert.ok(csv.startsWith('\uFEFFTicket,'))
    assert.ok(csv.includes('42'))
    assert.ok(csv.includes('"hello, world"'))
  })
})
