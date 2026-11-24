import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  adoptTimedOutStrictPending,
  resolveStrictPendingFromOrders,
  type StrictPendingIntent,
  type StrictPendingReconcile,
} from './strictEntryReconcile'

const intent = (over: Partial<{
  symbol: string
  operation: string
  comment: string | null
  volume: number
}> = {}) => ({
  symbol: 'XAUUSD',
  operation: 'SellLimit',
  comment: 'UniCopier:ch:d2533149:tp1:strictEntry',
  volume: 0.05,
  ...over,
})

describe('resolveStrictPendingFromOrders', () => {
  it('adopts a resting pending that matches symbol, side and comment', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 175274194, symbol: 'XAUUSD', operation: 'SellLimit', price: 3623, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
      { ticket: 222, symbol: 'EURUSD', operation: 'SellLimit', comment: 'UniCopier:ch:ffffffff:tp1' },
    ], intent())

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') {
      assert.equal(r.ticket, 175274194)
      assert.equal(r.filled, false, 'a resting pending is not a fill')
      assert.equal(r.openPrice, 3623)
    }
  })

  it('adopts a fill and reports filled=true so the caller knows it already executed', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 59469745534, symbol: 'XAUUSD', operation: 'Sell', openPrice: 3617.91, lots: 0.05, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') {
      assert.equal(r.ticket, 59469745534)
      assert.equal(r.filled, true)
      assert.equal(r.openPrice, 3617.91)
      assert.equal(r.lots, 0.05)
    }
  })

  it('never reports a pending as absent — zero matches are inconclusive', () => {
    // Reporting "absent" would let a caller resend and duplicate the entry.
    const r = resolveStrictPendingFromOrders([], intent())
    assert.equal(r.status, 'inconclusive')
    if (r.status === 'inconclusive') assert.match(r.reason, /no matching order/)
  })

  it('is inconclusive when several live orders match the same leg', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 1, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
      { ticket: 2, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
    if (r.status === 'inconclusive') assert.match(r.reason, /more than one/)
  })

  it('rejects a side mismatch', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 1, symbol: 'XAUUSD', operation: 'BuyLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
  })

  it('rejects a symbol mismatch', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 1, symbol: 'EURUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
  })

  it('rejects a different signal in the comment', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 1, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:abcdef01:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
  })

  it('rejects a SIBLING LEG of the same signal (:tp2 must not satisfy a :tp1 intent)', () => {
    // Every percent-split leg shares the same 8-hex prefix and differs only by
    // :tpN, so without this check leg 2 would adopt leg 1's live order and
    // stamp it with leg 2's volume and next_tp_index.
    const r = resolveStrictPendingFromOrders([
      { ticket: 999, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp2:strictEntry' },
    ], intent({ comment: 'UniCopier:ch:d2533149:tp1:strictEntry' }))

    assert.equal(r.status, 'inconclusive')
    if (r.status === 'inconclusive') assert.match(r.reason, /no matching order/)
  })

  it('matches its own :tpN even when MT4 truncated the comment to 31 chars', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 42, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:stric' },
    ], intent())
    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 42)
  })

  it('adopts our own order when the slug pushes :tpN past the 31-char cut (slug 9)', () => {
    // `UniCopier:gold-room:<id8>:tp1:strictEntry` truncates to
    // `...<id8>:tp` — the digit is gone, so any segment/`:tpN` check rejects
    // OUR OWN order and the live resting order is never adopted. Prefix
    // matching still identifies it. `gold-room` is a real fixture in this repo.
    const full = 'UniCopier:gold-room:d2533149:tp1:strictEntry'
    const truncated = full.slice(0, 31)
    assert.equal(truncated, 'UniCopier:gold-room:d2533149:tp')
    assert.ok(!truncated.includes('tp1'), 'precondition: the leg digit is cut')

    const r = resolveStrictPendingFromOrders([
      { ticket: 501, symbol: 'XAUUSD', operation: 'SellLimit', comment: truncated },
    ], intent({ comment: full }))

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 501)
  })

  it('adopts our own order at the maximum slug length (12)', () => {
    const full = 'UniCopier:abcdefghijkl:d2533149:tp1:strictEntry'
    const truncated = full.slice(0, 31)
    assert.equal(truncated, 'UniCopier:abcdefghijkl:d2533149', 'id8 survives at slug 12')

    const r = resolveStrictPendingFromOrders([
      { ticket: 502, symbol: 'XAUUSD', operation: 'SellLimit', comment: truncated },
    ], intent({ comment: full }))

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 502)
  })

  it('still rejects a sibling leg when the slug pushes the comment past the cut', () => {
    // At slug 9 both legs truncate to the SAME string, so the comment cannot
    // separate them — the lot-size check must. Without lots reported we must
    // stay inconclusive rather than guess.
    const truncated = 'UniCopier:gold-room:d2533149:tp'
    const r = resolveStrictPendingFromOrders([
      { ticket: 503, symbol: 'XAUUSD', operation: 'SellLimit', lots: 0.03, comment: truncated },
    ], intent({
      comment: 'UniCopier:gold-room:d2533149:tp1:strictEntry',
      volume: 0.05,
    }))

    assert.equal(r.status, 'inconclusive', 'a different lot size means a different leg')
  })

  it('matches and rejects range legs (:rgN.tpM) by prefix too', () => {
    const mine = 'UniCopier:ch:d2533149:rg1.tp2:strictEntry'
    const sibling = 'UniCopier:ch:d2533149:rg1.tp3:strictEntry'

    const ok = resolveStrictPendingFromOrders([
      { ticket: 601, symbol: 'XAUUSD', operation: 'SellLimit', comment: mine.slice(0, 31) },
    ], intent({ comment: mine }))
    assert.equal(ok.status, 'adopted', 'own range leg, truncated, must be adopted')

    const bad = resolveStrictPendingFromOrders([
      { ticket: 602, symbol: 'XAUUSD', operation: 'SellLimit', comment: sibling },
    ], intent({ comment: mine }))
    assert.equal(bad.status, 'inconclusive', 'a sibling range leg must be rejected')
  })

  it('rejects an order whose lot size is a different leg', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 5, symbol: 'XAUUSD', operation: 'SellLimit', lots: 0.03, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent({ volume: 0.05 }))
    assert.equal(r.status, 'inconclusive')
  })

  it('matches an MT4 numeric side (3 = SellLimit) that the market reader cannot read', () => {
    const r = resolveStrictPendingFromOrders([
      { ticket: 7, symbol: 'XAUUSD', type: 3, price: 3623, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 7)
  })

  it('still reads a side that lives in orderType/cmd rather than type', () => {
    // Regression guard: delegating to directionOf dropped kinds 0/1 that only
    // rawNumericOrderKind reads from orderType/cmd, so `{ orderType: 0 }`
    // stopped matching a buy (3040 brute-forced combinations).
    const r = resolveStrictPendingFromOrders([
      { ticket: 31, symbol: 'XAUUSD', orderType: 0, openPrice: 1.1, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
      { ticket: 32, symbol: 'XAUUSD', cmd: 1, openPrice: 1.2, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent({ operation: 'BuyLimit', volume: 0.1 }))

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 31, 'kind 0 via orderType must match a buy')
  })

  it('collapses order/position twins into one match instead of calling it ambiguous', () => {
    // The same fill seen twice must not block adoption — that was the whole
    // point of the opened-position dedupe.
    const r = resolveStrictPendingFromOrders([
      { ticket: 111, symbol: 'XAUUSD', operation: 'Sell', openPrice: 3617.91, lots: 0.05, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
      { positionTicket: 111, symbol: 'XAUUSD', operation: 'Sell', openPrice: 3617.91, lots: 0.05, comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent({ operation: 'Sell' }))

    assert.equal(r.status, 'adopted')
    if (r.status === 'adopted') assert.equal(r.ticket, 111)
  })

  it('does NOT adopt a row whose ticket only exists under keys the monitor cannot read', () => {
    // The monitor finds rows with rawOrderTicket (ticket/Ticket/order/Order/...).
    // Adopting a positionTicket it cannot read would make it cancel a live
    // trade six ticks later.
    const r = resolveStrictPendingFromOrders([
      { positionTicket: 777, symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
  })

  it('treats a non-list OpenedOrders response as inconclusive', () => {
    const r = resolveStrictPendingFromOrders('nope' as unknown as unknown[], intent())
    assert.equal(r.status, 'inconclusive')
  })

  it('ignores rows that carry no readable ticket', () => {
    const r = resolveStrictPendingFromOrders([
      { symbol: 'XAUUSD', operation: 'SellLimit', comment: 'UniCopier:ch:d2533149:tp1:strictEntry' },
    ], intent())
    assert.equal(r.status, 'inconclusive')
  })
})

// ---------------------------------------------------------------------------
// adoptTimedOutStrictPending — the rollback contract.
//
// If a found LIVE order cannot be recorded, leaving it untracked is the exact
// defect this module exists to remove, so a resting order must be rolled back
// at the broker (mirroring the normal path's api.orderClose) and the ticket
// must always come back for the audit row. A fill cannot be cancelled.
// ---------------------------------------------------------------------------

type SupabaseOpts = {
  tradesError?: string
  noId?: boolean
  sepError?: string
  /** Rows already owning this broker ticket (ownership pre-check). */
  ownedCount?: number
  /** Simulate the ownership lookup itself failing. */
  ownedError?: string
}

function makeSupabase(opts: SupabaseOpts = {}) {
  const log: Array<{ table: string; op: string; row?: Record<string, unknown> }> = []
  return {
    log,
    from(table: string) {
      return {
        // Ownership pre-check: .select(...).eq().eq().gte() -> { count, error }
        select() {
          const chain = {
            eq: () => chain,
            gte: () => Promise.resolve({
              count: opts.ownedCount ?? 0,
              error: opts.ownedError ? { message: opts.ownedError } : null,
            }),
          }
          return chain
        },
        insert(row: Record<string, unknown>) {
          log.push({ table, op: 'insert', row })
          if (table === 'trades') {
            const error = opts.tradesError ? { message: opts.tradesError } : null
            const data = opts.noId || error ? null : { id: 'trade-abc' }
            return {
              select: () => ({ maybeSingle: async () => ({ data, error }) }),
            }
          }
          const error = opts.sepError ? { message: opts.sepError } : null
          return {
            then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return Promise.resolve({ error }).then(onFulfilled, onRejected)
            },
          }
        },
        delete() {
          log.push({ table, op: 'delete' })
          return {
            eq: () => {
              log.push({ table, op: 'eq' })
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
}

type ApiOpts = {
  cancelImpl?: () => Promise<unknown>
  /** Snapshot returned by /OpenedOrders during the rollback re-read. */
  opened?: unknown[] | (() => Promise<unknown[]>)
}

function makeApi(opts: ApiOpts = {}) {
  const cancelled: Array<{ id: string; ticket: number }> = []
  const api = {
    orderCancel: async (id: string, args: { ticket: number }) => {
      cancelled.push({ id, ticket: args.ticket })
      if (opts.cancelImpl) return await opts.cancelImpl()
      return {}
    },
    orderClose: async () => ({}),
    openedOrders: async () => {
      if (typeof opts.opened === 'function') return await opts.opened()
      return opts.opened ?? []
    },
  }
  return { api: api as never, cancelled }
}

/** A resting SellLimit the rollback re-read must still see as resting. */
const restingAtBroker = {
  ticket: 175274194, symbol: 'XAUUSD', operation: 'SellLimit',
  price: 3623, comment: 'UniCopier:ch:d2533149:tp1:strictEntry',
}
/** The same ticket after it filled — cancelling this would close a position. */
const filledAtBroker = {
  ticket: 175274194, symbol: 'XAUUSD', operation: 'Sell',
  openPrice: 3617.91, comment: 'UniCopier:ch:d2533149:tp1:strictEntry',
}

function makeIntent(supabase: unknown, api: unknown): StrictPendingIntent {
  return {
    ctx: { supabase } as never,
    prep: {
      signal: { id: 'sig-1', user_id: 'user-1', channel_id: 'chan-1' },
      broker: { id: 'broker-1', provider: 'fxsocket' },
      uuid: 'session-1',
      symbol: 'XAUUSD',
      params: null,
      api,
      manual: {},
      plan: {},
    } as never,
    entryPx: 3623,
    pendingOp: 'SellLimit',
    expiresAt: null,
    digits: 2,
    volume: 0.05,
    stoploss: 3628,
    takeprofit: 3612,
    slippage: 20,
    comment: 'UniCopier:ch:d2533149:tp1:strictEntry',
    expertID: 909090,
    partialTpPlan: null,
    nextTpIndex: 1,
  }
}

const resting: Extract<StrictPendingReconcile, { status: 'adopted' }> = {
  status: 'adopted', ticket: 175274194, openPrice: null,
  stopLoss: 3628, takeProfit: 3612, lots: 0.05, filled: false,
}
const filled: typeof resting = { ...resting, filled: true, openPrice: 3617.91 }

describe('adoptTimedOutStrictPending', () => {
  it('records both rows and does not cancel when the writes succeed', async () => {
    const sb = makeSupabase()
    const { api, cancelled } = makeApi()

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.deepEqual(out, { ok: true })
    assert.equal(cancelled.length, 0, 'a successful adopt must not cancel')
    assert.deepEqual(
      sb.log.filter(c => c.table === 'trades').map(c => c.op),
      ['insert'],
      'trades row inserted, never deleted',
    )
    assert.ok(sb.log.some(c => c.table === 'signal_entry_pending_orders' && c.op === 'insert'))
  })

  it('does NOT adopt or cancel a ticket another row already owns', async () => {
    // The matcher compares comments only, and once MT4 truncation erases a
    // leg's :tpN two legs become comment-identical. Adopting a sibling's
    // already-tracked order would hit trades_broker_order_unique_idx, and the
    // insert failure would flow into fail() and CANCEL a live managed order.
    const sb = makeSupabase({ ownedCount: 1 })
    const { api, cancelled } = makeApi({ opened: [restingAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.alreadyTracked, true)
      assert.equal(out.cancelled, false, 'an owned order must never be cancelled')
      assert.equal(out.ticket, 175274194)
    }
    assert.equal(cancelled.length, 0)
    assert.ok(!sb.log.some(c => c.table === 'trades' && c.op === 'insert'), 'no duplicate insert attempted')
  })

  it('does NOT cancel when ownership cannot be verified', async () => {
    // Unknown ownership means cancelling could destroy another row's live
    // order, so the safe answer is to leave the broker alone. This must NOT be
    // flagged alreadyTracked: that flag makes the caller emit a bare
    // `inconclusive`, which drops the ticket from error_message — and the
    // ticket is the only DB record of a possibly-live order.
    const sb = makeSupabase({ ownedError: 'network down' })
    const { api, cancelled } = makeApi({ opened: [restingAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.alreadyTracked, undefined, 'unverifiable ownership is not "already tracked"')
      assert.equal(out.cancelled, false)
      assert.equal(out.ticket, 175274194, 'the ticket must still be returned for the audit row')
    }
    assert.equal(cancelled.length, 0, 'unverifiable ownership means do not cancel')
  })

  it('rolls back when the trades insert succeeds but returns no id', async () => {
    const sb = makeSupabase({ noId: true })
    const { api, cancelled } = makeApi({ opened: [restingAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.ticket, 175274194)
      assert.equal(out.cancelled, true, 'no row means the order must not be left live and untracked')
    }
    assert.deepEqual(cancelled, [{ id: 'session-1', ticket: 175274194 }])
    assert.ok(!sb.log.some(c => c.table === 'signal_entry_pending_orders'), 'no sep row without a trade')
  })

  it('rolls back at the broker when the trades insert fails', async () => {
    const sb = makeSupabase({ tradesError: 'duplicate broker ticket' })
    const { api, cancelled } = makeApi({ opened: [restingAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.ticket, 175274194, 'the ticket must survive for the audit row')
      assert.equal(out.cancelled, true)
    }
    assert.deepEqual(cancelled, [{ id: 'session-1', ticket: 175274194 }])
    assert.ok(!sb.log.some(c => c.table === 'signal_entry_pending_orders'), 'no half-written sep row')
  })

  it('deletes the half-written trades row and rolls back when the sep insert fails', async () => {
    const sb = makeSupabase({ sepError: 'unique violation' })
    const { api, cancelled } = makeApi({ opened: [restingAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) assert.equal(out.cancelled, true)
    assert.deepEqual(
      sb.log.filter(c => c.table === 'trades').map(c => c.op),
      ['insert', 'delete', 'eq'],
      'the orphan trades row must be removed',
    )
    assert.deepEqual(cancelled, [{ id: 'session-1', ticket: 175274194 }])
  })

  it('does NOT cancel when the order filled between the probe and the rollback', async () => {
    // `found.filled` is a snapshot taken before the DB writes. On FXSocket
    // orderCancel IS orderClose, so cancelling here would close the
    // customer's just-opened position and label it "cancelled".
    const sb = makeSupabase({ tradesError: 'insert failed' })
    const { api, cancelled } = makeApi({ opened: [filledAtBroker] })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.cancelled, false, 'a fill must never be sent to cancel')
      assert.equal(out.ticket, 175274194)
    }
    assert.equal(cancelled.length, 0)
  })

  it('does NOT cancel when the fresh snapshot cannot be read', async () => {
    const sb = makeSupabase({ tradesError: 'insert failed' })
    const { api, cancelled } = makeApi({ opened: () => { throw new Error('bridge down') } })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.cancelled, false, 'unreadable snapshot means do not cancel')
      assert.equal(out.ticket, 175274194, 'ticket still reaches the audit row')
    }
    assert.equal(cancelled.length, 0)
  })

  it('does NOT cancel a fill — it cannot be rolled back — but still returns the ticket', async () => {
    const sb = makeSupabase({ tradesError: 'insert failed' })
    const { api, cancelled } = makeApi()

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), filled)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.ticket, 175274194)
      assert.equal(out.cancelled, false, 'a filled ticket must never be sent to cancel')
    }
    assert.equal(cancelled.length, 0)
  })

  it('still returns the ticket when the rollback itself fails', async () => {
    const sb = makeSupabase({ tradesError: 'insert failed' })
    const { api } = makeApi({
      cancelImpl: () => { throw new Error('bridge down') },
      opened: [restingAtBroker],
    })

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), resting)

    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.ticket, 175274194, 'ticket is the only record of a live untracked order')
      assert.equal(out.cancelled, false)
    }
  })

  it('falls back to the clamped intent stops when the broker reports none', async () => {
    const sb = makeSupabase()
    const { api } = makeApi()
    // Broker row carries no SL/TP, so the fallback path is exercised.
    const noStops: typeof resting = { ...resting, stopLoss: null, takeProfit: null }

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), noStops)

    assert.equal(out.ok, true)
    const sep = sb.log.find(c => c.table === 'signal_entry_pending_orders')
    assert.ok(sep?.row, 'sep row was written')
    assert.equal(sep!.row!.stoploss, 3628, 'SL falls back to the clamped intent value')
    assert.equal(sep!.row!.takeprofit, 3612, 'TP falls back to the clamped intent value')
    assert.equal(sep!.row!.slippage, 20)
  })

  it('prefers the broker-reported stops over the intent values', async () => {
    const sb = makeSupabase()
    const { api } = makeApi()
    const fromBroker: typeof resting = { ...resting, stopLoss: 3630, takeProfit: 3615 }

    const out = await adoptTimedOutStrictPending(makeIntent(sb, api), fromBroker)

    assert.equal(out.ok, true)
    const sep = sb.log.find(c => c.table === 'signal_entry_pending_orders')
    assert.equal(sep!.row!.stoploss, 3630, 'what is on the order wins')
    assert.equal(sep!.row!.takeprofit, 3615)
  })
})
