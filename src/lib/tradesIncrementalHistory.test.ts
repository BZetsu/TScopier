import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MtTrade } from './fxsocketBroker'
import {
  incrementalHistoryFrom,
  mergeIncrementalTrades,
  nextFullHistoryAt,
  resolveHistoryReadMode,
  resolveHistoryWindow,
} from './tradesIncrementalHistory'

function trade(
  overrides: Partial<MtTrade> & Pick<MtTrade, 'broker_id' | 'ticket'>,
): MtTrade {
  return {
    id: `${overrides.broker_id}:${overrides.ticket}`,
    broker_label: 'Acct',
    broker_name: 'Broker',
    symbol: 'XAUUSD',
    direction: 'buy',
    type: 'Buy',
    lot_size: 0.1,
    entry_price: 2500,
    sl: null,
    tp: null,
    close_price: 2510,
    profit: 100,
    swap: 0,
    commission: 0,
    comment: null,
    magic: null,
    opened_at: '2026-11-13T10:00:00',
    closed_at: '2026-11-13T12:00:00',
    state: null,
    status: 'closed',
    ...overrides,
  }
}

describe('incrementalHistoryFrom', () => {
  it('starts one day before the newest cached close', () => {
    const trades = [
      trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-11-10T12:00:00' }),
      trade({ broker_id: 'b1', ticket: 2, closed_at: '2026-11-13T12:00:00' }),
    ]
    // `now` pinned: with the wall clock the 7-day clamp eventually overrides
    // the buffer and the expectation drifts with the calendar.
    assert.equal(incrementalHistoryFrom(trades, Date.parse('2026-11-14T12:00:00')), '2026-11-12')
  })

  it('clamps dormant accounts to the last seven days', () => {
    const now = new Date(2026, 10, 13, 12).getTime()
    const trades = [
      trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-08-01T12:00:00' }),
    ]
    assert.equal(incrementalHistoryFrom(trades, now), '2026-11-06')
  })

  it('never requests a window that starts in the future', () => {
    const now = new Date(2026, 10, 13, 12).getTime()
    const trades = [
      trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-12-01T12:00:00' }),
    ]
    assert.equal(incrementalHistoryFrom(trades, now), '2026-11-13')
  })

  it('starts yesterday when the cache has no closed trades', () => {
    const now = new Date(2026, 10, 13, 12).getTime()
    const trades = [
      trade({
        broker_id: 'b1',
        ticket: 1,
        status: 'open',
        closed_at: null,
        opened_at: '2026-11-01T10:00:00',
      }),
    ]
    assert.equal(incrementalHistoryFrom(trades, now), '2026-11-12')
  })
})

describe('mergeIncrementalTrades', () => {
  it('keeps cached closes missing from live, prefers live rows, and drops cached opens', () => {
    const live = [
      trade({ broker_id: 'b1', ticket: 2, closed_at: '2026-11-13T12:00:00' }),
      trade({
        broker_id: 'b1',
        ticket: 3,
        status: 'open',
        closed_at: null,
        opened_at: '2026-11-10T09:00:00',
      }),
    ]
    const cached = [
      trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-10-01T12:00:00' }),
      trade({ broker_id: 'b1', ticket: 2, closed_at: '2026-11-13T10:00:00' }),
      trade({
        broker_id: 'b1',
        ticket: 3,
        status: 'open',
        closed_at: null,
        opened_at: '2026-11-10T09:00:00',
      }),
      trade({ broker_id: 'b1', ticket: 4, closed_at: '2026-11-13T13:00:00' }),
    ]

    const merged = mergeIncrementalTrades(live, cached)
    assert.deepEqual(merged.map(t => t.id), ['b1:4', 'b1:2', 'b1:3', 'b1:1'])
    assert.equal(merged.find(t => t.id === 'b1:2')?.closed_at, '2026-11-13T12:00:00')
  })

  it('drops cached rows for accounts that are no longer linked', () => {
    const live = [trade({ broker_id: 'b1', ticket: 2 })]
    const cached = [trade({ broker_id: 'b2', ticket: 1, closed_at: '2026-10-01T12:00:00' })]

    const merged = mergeIncrementalTrades(live, cached, new Set(['b1']))
    assert.deepEqual(merged.map(t => t.id), ['b1:2'])
  })

  it('drops live rows for accounts that are no longer linked', () => {
    const live = [
      trade({ broker_id: 'b1', ticket: 1 }),
      trade({ broker_id: 'b2', ticket: 2 }),
    ]
    const merged = mergeIncrementalTrades(live, [], new Set(['b1']))
    assert.deepEqual(merged.map(t => t.id), ['b1:1'])
  })

  it('sorts rows with missing times last', () => {
    const live = [
      trade({
        broker_id: 'b1',
        ticket: 1,
        closed_at: null,
        opened_at: null,
      }),
      trade({ broker_id: 'b1', ticket: 2, closed_at: '2026-10-01T12:00:00' }),
    ]
    const merged = mergeIncrementalTrades(live, [])
    assert.deepEqual(merged.map(t => t.id), ['b1:2', 'b1:1'])
  })

  it('does not duplicate rows with the same id', () => {
    const live = [trade({ broker_id: 'b1', ticket: 1 })]
    const cached = [trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-10-01T12:00:00' })]

    const merged = mergeIncrementalTrades(live, cached)
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.closed_at, '2026-11-13T12:00:00')
  })
})

describe('resolveHistoryReadMode', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  const hourMs = 60 * 60 * 1000
  const dayMs = 24 * hourMs

  it('reads full when there is no cache to build an incremental window from', () => {
    assert.equal(
      resolveHistoryReadMode({ hasCache: false, degraded: false, recoveredFromDegraded: false, now, fullHistoryAt: now }),
      'full',
    )
  })

  it('reads incremental on a healthy feed inside the daily refresh interval', () => {
    assert.equal(
      resolveHistoryReadMode({ hasCache: true, degraded: false, recoveredFromDegraded: false, now, fullHistoryAt: now - hourMs }),
      'incremental',
    )
  })

  it('reads incremental while degraded even with NO cache — the cacheless outage tab', () => {
    // Failures never write the session cache, so a tab opened during an outage
    // stays cacheless for the whole outage; without this ordering it would
    // full-read on every refresh — the exact loop of the 2026-11-25 incident.
    assert.equal(
      resolveHistoryReadMode({ hasCache: false, degraded: true, recoveredFromDegraded: false, now, fullHistoryAt: now - 3 * dayMs }),
      'incremental',
    )
  })

  it('reads full once a day has passed since the last full read', () => {
    assert.equal(
      resolveHistoryReadMode({ hasCache: true, degraded: false, recoveredFromDegraded: false, now, fullHistoryAt: now - dayMs - 1 }),
      'full',
    )
  })

  it('NEVER reads full while degraded — the loop that amplified the 2026-11-25 bridge stalls', () => {
    // Even when the daily refresh is due, a degraded feed stays incremental.
    assert.equal(
      resolveHistoryReadMode({ hasCache: true, degraded: true, recoveredFromDegraded: false, now, fullHistoryAt: now - 3 * dayMs }),
      'incremental',
    )
  })

  it('reads full once on recovery from degraded, to self-heal', () => {
    assert.equal(
      resolveHistoryReadMode({ hasCache: true, degraded: false, recoveredFromDegraded: true, now, fullHistoryAt: now - 2 * hourMs }),
      'full',
    )
  })

  it('bounds recovery full reads to at most one per hour of prior full age', () => {
    // A flapping feed recovering 10 minutes after its last full read must not
    // trigger another full read — that would recreate the stampede.
    assert.equal(
      resolveHistoryReadMode({ hasCache: true, degraded: false, recoveredFromDegraded: true, now, fullHistoryAt: now - 10 * 60 * 1000 }),
      'incremental',
    )
  })
})

describe('resolveHistoryWindow', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  const cached = [trade({ broker_id: 'b1', ticket: 1, closed_at: '2026-11-20T12:00:00' })]

  it('full mode requests the full-history start and has no merge base', () => {
    const w = resolveHistoryWindow({ readMode: 'full', cacheTrades: cached, now })
    assert.equal(w.historyFrom, '2000-01-01')
    assert.equal(w.incrementalCache, null)
  })

  it('incremental with a cache anchors on the cached rows and merges them', () => {
    const w = resolveHistoryWindow({ readMode: 'incremental', cacheTrades: cached, now })
    assert.equal(w.historyFrom, '2026-11-19') // newest close (Nov 20) minus one day
    assert.equal(w.incrementalCache, cached)
  })

  it('degraded cacheless anchors at yesterday with no merge base', () => {
    const w = resolveHistoryWindow({ readMode: 'incremental', cacheTrades: null, now })
    assert.equal(w.historyFrom, '2026-11-24')
    assert.equal(w.incrementalCache, null)
  })
})

describe('nextFullHistoryAt', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')

  it('cold full read stamps fetchedAt', () => {
    assert.equal(
      nextFullHistoryAt({ readMode: 'full', hasIncrementalCache: false, previousMarker: 0, fetchedAt: now }),
      now,
    )
  })

  it('daily full read stamps fetchedAt even with a cache present', () => {
    assert.equal(
      nextFullHistoryAt({ readMode: 'full', hasIncrementalCache: true, previousMarker: now - 3 * 86400000, fetchedAt: now }),
      now,
    )
  })

  it('incremental with a cache preserves the previous marker', () => {
    const marker = now - 86400000
    assert.equal(
      nextFullHistoryAt({ readMode: 'incremental', hasIncrementalCache: true, previousMarker: marker, fetchedAt: now }),
      marker,
    )
  })

  it('degraded cacheless records 0 so the next healthy load takes the full branch', () => {
    assert.equal(
      nextFullHistoryAt({ readMode: 'incremental', hasIncrementalCache: false, previousMarker: 0, fetchedAt: now }),
      0,
    )
  })
})
