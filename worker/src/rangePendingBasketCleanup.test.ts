import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGhostBasketLegs } from './basketSlTpReconcile'
import {
  ACTIVE_RANGE_PENDING_LEG_STATUSES,
  hasActiveRangePendingLegs,
  purgeRangePendingLegsIfBasketFlat,
} from './rangePendingLegDelete'
import {
  reconcileBasketFlatFromBroker,
  reconcilePendingLegBasketsFromBroker,
} from './rangePendingBasketCleanup'

type TradeRow = {
  id: string
  signal_id: string
  broker_account_id: string
  status: string
  metaapi_order_id?: string | null
}

type PendingRow = {
  id: string
  signal_id: string
  broker_account_id: string
  metaapi_account_id?: string
  status: string
}

class CleanupSupabase {
  readonly operations: string[] = []

  constructor(
    readonly trades: TradeRow[] = [],
    readonly pending: PendingRow[] = [],
  ) {}

  from(table: string): CleanupQuery {
    return new CleanupQuery(this, table)
  }
}

class CleanupQuery implements PromiseLike<{ data: unknown; error: null; count?: number | null }> {
  private op: 'select' | 'delete' | 'update' | null = null
  private countMode = false
  private filters = new Map<string, unknown>()
  private inFilters = new Map<string, unknown[]>()
  private patch: Record<string, unknown> | null = null

  constructor(
    private readonly db: CleanupSupabase,
    private readonly table: string,
  ) {}

  select(columns = '', opts?: { count?: string; head?: boolean }): this {
    void columns
    this.op = this.op ?? 'select'
    this.countMode = opts?.count === 'exact' || opts?.head === true
    return this
  }

  delete(): this {
    this.op = 'delete'
    return this
  }

  update(patch: Record<string, unknown>): this {
    this.op = 'update'
    this.patch = patch
    return this
  }

  eq(key: string, value: unknown): this {
    this.filters.set(key, value)
    return this
  }

  in(key: string, values: unknown[]): this {
    this.inFilters.set(key, values)
    return this
  }

  limit(): this {
    return this
  }

  then<TResult1 = { data: unknown; error: null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }

  private resolve(): { data: unknown; error: null; count?: number | null } {
    if (this.table === 'trades') return this.resolveTrades()
    if (this.table === 'range_pending_legs') return this.resolvePending()
    if (this.table === 'range_pending_tp_locks') {
      this.db.operations.push('tp-lock-clear')
      return { data: [], error: null }
    }
    return { data: null, count: 0, error: null }
  }

  private resolveTrades(): { data: unknown; error: null; count?: number | null } {
    if (this.op === 'update') {
      this.db.operations.push('trade-update')
      const rows = this.db.trades.filter(r => this.matches(r))
      for (const row of rows) Object.assign(row, this.patch)
      return { data: rows.map(r => ({ id: r.id })), error: null }
    }

    const rows = this.db.trades.filter(r => this.matches(r))
    this.db.operations.push(this.countMode ? 'trade-count' : 'trade-select')
    return this.countMode
      ? { data: null, count: rows.length, error: null }
      : { data: rows.map(r => ({ id: r.id, status: r.status, metaapi_order_id: r.metaapi_order_id ?? null })), error: null }
  }

  private resolvePending(): { data: unknown; error: null; count?: number | null } {
    const rows = this.db.pending.filter(r => this.matches(r))
    if (this.op === 'delete') {
      this.db.operations.push('pending-delete')
      const ids = new Set(rows.map(r => r.id))
      for (let i = this.db.pending.length - 1; i >= 0; i--) {
        if (ids.has(this.db.pending[i]!.id)) this.db.pending.splice(i, 1)
      }
      return { data: rows.map(r => ({ id: r.id })), error: null }
    }

    this.db.operations.push(this.countMode ? 'pending-count' : 'pending-select')
    return this.countMode
      ? { data: null, count: rows.length, error: null }
      : { data: rows, error: null }
  }

  private matches(row: Record<string, unknown>): boolean {
    for (const [key, value] of this.filters) {
      if (row[key] !== value) return false
    }
    for (const [key, values] of this.inFilters) {
      if (!values.includes(row[key])) return false
    }
    return true
  }
}

const scope = { signalId: 'signal-1', brokerAccountId: 'broker-1' }

function activePending(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: 'pending-1',
    signal_id: 'signal-1',
    broker_account_id: 'broker-1',
    metaapi_account_id: 'session-1',
    status: 'pending',
    ...overrides,
  }
}

describe('range pending cleanup — broker flat detection', () => {
  it('treats DB open legs missing from broker as ghosts (SL / manual close)', () => {
    const family = [
      {
        id: 't1',
        signal_id: 'sig-1',
        metaapi_order_id: '1001',
        opened_at: '',
        lot_size: 0.01,
        sl: null,
        tp: null,
        entry_price: 2000,
        direction: 'buy',
        symbol: 'XAUUSD',
      },
    ]
    const { onBroker, ghost } = classifyGhostBasketLegs(family, new Set())
    assert.equal(onBroker.length, 0)
    assert.equal(ghost.length, 1)
    assert.equal(ghost[0]?.id, 't1')
  })

  it('keeps legs that still exist on broker', () => {
    const family = [
      {
        id: 't1',
        signal_id: 'sig-1',
        metaapi_order_id: '1001',
        opened_at: '',
        lot_size: 0.01,
        sl: null,
        tp: null,
        entry_price: 2000,
        direction: 'buy',
        symbol: 'XAUUSD',
      },
    ]
    const { onBroker, ghost } = classifyGhostBasketLegs(family, new Set([1001]))
    assert.equal(onBroker.length, 1)
    assert.equal(ghost.length, 0)
  })

  it('defines only waiting/firing range rows as active liveness states', () => {
    assert.deepEqual([...ACTIVE_RANGE_PENDING_LEG_STATUSES], ['pending', 'claimed', 'broker_pending'])
  })

  it('zero trade rows + active deferred pending does not purge', async () => {
    const db = new CleanupSupabase([], [activePending()])
    const purged = await purgeRangePendingLegsIfBasketFlat(db as never, scope, 'signal_closed')

    assert.equal(purged, 0)
    assert.equal(db.pending.length, 1)
    assert.equal(db.operations.includes('pending-delete'), false)
  })

  it('deferred-only BUY pending survives first cleanup/reconcile', async () => {
    const db = new CleanupSupabase([], [activePending({ id: 'buy-leg', status: 'pending' })])
    const reason = await reconcileBasketFlatFromBroker(db as never, null, 'session-1', scope)

    assert.equal(reason, null)
    assert.deepEqual(db.pending.map(r => r.id), ['buy-leg'])
    assert.equal(db.operations.includes('pending-delete'), false)
  })

  it('deferred-only SELL pending survives first cleanup/reconcile', async () => {
    const db = new CleanupSupabase([], [activePending({ id: 'sell-leg', status: 'pending' })])
    const purged = await reconcilePendingLegBasketsFromBroker(
      db as never,
      [{ signal_id: 'signal-1', broker_account_id: 'broker-1', metaapi_account_id: 'session-1' }],
      () => null,
    )

    assert.equal(purged, 0)
    assert.deepEqual(db.pending.map(r => r.id), ['sell-leg'])
    assert.equal(db.operations.includes('pending-delete'), false)
  })

  it('zero trade rows + no active pending purges stale basket state', async () => {
    const db = new CleanupSupabase([], [activePending({ status: 'cancelled' })])
    const purged = await purgeRangePendingLegsIfBasketFlat(db as never, scope, 'signal_closed')

    assert.equal(purged, 1)
    assert.equal(db.pending.length, 0)
    assert.ok(db.operations.includes('pending-delete'))
  })

  it('terminal pending state does not keep the basket alive forever', async () => {
    for (const status of ['cancelled', 'expired', 'failed', 'fired']) {
      const db = new CleanupSupabase([], [activePending({ status })])
      assert.equal(await hasActiveRangePendingLegs(db as never, scope), false)
    }
  })

  it('open trade + pending preserves existing behavior', async () => {
    const db = new CleanupSupabase(
      [{ id: 'trade-1', signal_id: 'signal-1', broker_account_id: 'broker-1', status: 'open' }],
      [activePending()],
    )
    const purged = await purgeRangePendingLegsIfBasketFlat(db as never, scope, 'basket_flat')

    assert.equal(purged, 0)
    assert.equal(db.pending.length, 1)
    assert.equal(db.operations.includes('pending-delete'), false)
  })

  it('already materialized leg does not keep a dead basket alive', async () => {
    const db = new CleanupSupabase([], [activePending({ status: 'fired' })])
    const reason = await reconcileBasketFlatFromBroker(db as never, null, 'session-1', scope)

    assert.equal(reason, null)
    assert.deepEqual(db.pending.map(r => r.status), ['fired'])
    assert.equal(await hasActiveRangePendingLegs(db as never, scope), false)
  })

  it('closed trade history allows active leftover pendings to be purged', async () => {
    const db = new CleanupSupabase(
      [{ id: 'trade-1', signal_id: 'signal-1', broker_account_id: 'broker-1', status: 'closed' }],
      [activePending()],
    )
    const purged = await purgeRangePendingLegsIfBasketFlat(db as never, scope, 'basket_flat')

    assert.equal(purged, 1)
    assert.equal(db.pending.length, 0)
  })

  it('multi-account cleanup is scoped by signal_id + broker_account_id', async () => {
    const db = new CleanupSupabase(
      [{ id: 'trade-a', signal_id: 'signal-1', broker_account_id: 'broker-a', status: 'closed' }],
      [
        activePending({ id: 'leg-a', broker_account_id: 'broker-a' }),
        activePending({ id: 'leg-b', broker_account_id: 'broker-b' }),
      ],
    )

    const purgedA = await purgeRangePendingLegsIfBasketFlat(
      db as never,
      { signalId: 'signal-1', brokerAccountId: 'broker-a' },
      'basket_flat',
    )
    const purgedB = await purgeRangePendingLegsIfBasketFlat(
      db as never,
      { signalId: 'signal-1', brokerAccountId: 'broker-b' },
      'basket_flat',
    )

    assert.equal(purgedA, 1)
    assert.equal(purgedB, 0)
    assert.deepEqual(db.pending.map(r => r.id), ['leg-b'])
  })

  it('two deferred-only broker accounts remain isolated during first reconcile', async () => {
    const db = new CleanupSupabase(
      [],
      [
        activePending({ id: 'leg-a', broker_account_id: 'broker-a' }),
        activePending({ id: 'leg-b', broker_account_id: 'broker-b' }),
      ],
    )

    const purged = await reconcilePendingLegBasketsFromBroker(
      db as never,
      [
        { signal_id: 'signal-1', broker_account_id: 'broker-a', metaapi_account_id: 'session-a' },
        { signal_id: 'signal-1', broker_account_id: 'broker-b', metaapi_account_id: 'session-b' },
      ],
      () => null,
    )

    assert.equal(purged, 0)
    assert.deepEqual(db.pending.map(r => r.id).sort(), ['leg-a', 'leg-b'])
  })

  it('terminal state on one account cannot purge another account active pending', async () => {
    const db = new CleanupSupabase(
      [],
      [
        activePending({ id: 'terminal-a', broker_account_id: 'broker-a', status: 'cancelled' }),
        activePending({ id: 'active-b', broker_account_id: 'broker-b', status: 'claimed' }),
      ],
    )

    const purged = await reconcilePendingLegBasketsFromBroker(
      db as never,
      [
        { signal_id: 'signal-1', broker_account_id: 'broker-a', metaapi_account_id: 'session-a' },
        { signal_id: 'signal-1', broker_account_id: 'broker-b', metaapi_account_id: 'session-b' },
      ],
      () => null,
    )

    assert.equal(purged, 1)
    assert.deepEqual(db.pending.map(r => r.id), ['active-b'])
  })
})
