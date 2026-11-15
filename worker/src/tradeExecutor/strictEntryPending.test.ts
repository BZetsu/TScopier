import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { placeStrictSignalEntryPending } from './strictEntryPending'
import type { PreparedEntry } from './entryPrepare'

function makePrep(overrides: {
  capped: Array<{
    volume: number
    stoploss?: number
    takeprofit?: number
    comment?: string
    slippage?: number
    expertID?: number
  }>
  tradeStyle?: 'single' | 'multi'
}): PreparedEntry {
  const sends: unknown[] = []
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const api = {
    orderSend: async (_uuid: string, args: unknown) => {
      sends.push(args)
      return { ticket: 1000 + sends.length, lots: (args as { volume: number }).volume }
    },
    orderClose: async () => ({}),
  }
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row })
          const result = {
            select() {
              return {
                maybeSingle: async () => ({ data: { id: `trade-${inserts.length}` }, error: null }),
              }
            },
            then(
              resolve: (v: { error: null }) => unknown,
              reject?: (e: unknown) => unknown,
            ) {
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
          return result
        },
      }
    },
  }

  return {
    ctx: { supabase } as never,
    signal: {
      id: 'sig-1',
      user_id: 'user-1',
      channel_id: 'chan-1',
    } as never,
    parsed: {} as never,
    broker: { id: 'broker-1', provider: 'fxsocket' } as never,
    manual: {
      trade_style: overrides.tradeStyle ?? 'single',
      range_trading: false,
      pending_expiry_hours: 4,
      tp_lots: [
        { label: 'TP1', lot: 0, percent: 50, enabled: true },
        { label: 'TP2', lot: 0, percent: 30, enabled: true },
        { label: 'TP3', lot: 0, percent: 20, enabled: true },
      ],
    } as never,
    api: api as never,
    uuid: 'uuid-1',
    symbol: 'BTCUSDm',
    requestedSymbol: 'BTCUSD',
    mapping: {} as never,
    params: { digits: 2, point: 0.01, minLot: 0.01, lotStep: 0.01, contractSize: 1, stopsLevel: 0, freezeLevel: 0 },
    liveEntryFast: false,
    pipelineT0: Date.now(),
    strictEntryPrefetch: null,
    commentPrefix: 'UniCopier:test:sig-1',
    channelDelayMs: 0,
    channelDelaySkipped: false,
    plan: {
      orders: overrides.capped,
      strictEntry: { entryPrice: 64950, isBuy: false },
      autoBeTpHitTriggerPrice: null,
    } as never,
    capped: overrides.capped.map(o => ({
      symbol: 'BTCUSDm',
      operation: 'Sell' as const,
      volume: o.volume,
      price: 0,
      stoploss: o.stoploss ?? 65150,
      takeprofit: o.takeprofit ?? 0,
      slippage: o.slippage ?? 20,
      comment: o.comment,
      expertID: o.expertID ?? 909090,
    })) as never,
    virtualPendings: [],
    legs: [],
    deferVirtualAnchor: false,
    deferBrokerRangePendingMaterialize: false,
    strictDeferred: true,
    op: 'Sell' as never,
    channelKeywords: null,
    baseLot: 5,
    anchor: null,
    anchorSource: 'signal' as const,
    // expose for assertions
    __sends: sends,
    __inserts: inserts,
  } as PreparedEntry & { __sends: unknown[]; __inserts: unknown[] }
}

describe('placeStrictSignalEntryPending percent-split', () => {
  it('places one pending per TP leg (not one full-lot aggregate)', async () => {
    const prep = makePrep({
      capped: [
        { volume: 2.5, takeprofit: 64200, comment: 'UniCopier:test:sig-1:tp1' },
        { volume: 1.5, takeprofit: 64000, comment: 'UniCopier:test:sig-1:tp2' },
        { volume: 1.0, takeprofit: 63900, comment: 'UniCopier:test:sig-1:tp3' },
      ],
    }) as PreparedEntry & { __sends: Array<Record<string, unknown>>; __inserts: Array<{ table: string; row: Record<string, unknown> }> }

    const ok = await placeStrictSignalEntryPending(prep.ctx, prep, true)
    assert.equal(ok, true)
    assert.equal(prep.__sends.length, 3)
    assert.deepEqual(
      prep.__sends.map(s => ({ v: s.volume, tp: s.takeprofit, op: s.operation })),
      [
        { v: 2.5, tp: 64200, op: 'SellLimit' },
        { v: 1.5, tp: 64000, op: 'SellLimit' },
        { v: 1.0, tp: 63900, op: 'SellLimit' },
      ],
    )
    const tradeRows = prep.__inserts.filter(i => i.table === 'trades')
    assert.equal(tradeRows.length, 3)
    assert.deepEqual(
      tradeRows.map(r => r.row.next_tp_index),
      [1, 2, 3],
    )
    assert.ok(prep.__sends.every(s => String(s.comment).includes(':tp')))
    assert.ok(!prep.__sends.some(s => String(s.comment).includes('strictEntryAgg')))
  })

  it('still aggregates classic multi into one pending', async () => {
    const prep = makePrep({
      tradeStyle: 'multi',
      capped: [
        { volume: 0.5, takeprofit: 64000, comment: 'UniCopier:test:sig-1:tp1' },
        { volume: 0.5, takeprofit: 64000, comment: 'UniCopier:test:sig-1:tp1' },
      ],
    }) as PreparedEntry & { __sends: Array<Record<string, unknown>> }

    // multi without TP_BUNDLE → isTpPercentSplitBasket false → aggregate path
    const ok = await placeStrictSignalEntryPending(prep.ctx, prep, false)
    assert.equal(ok, true)
    assert.equal(prep.__sends.length, 1)
    assert.equal(prep.__sends[0]!.volume, 1)
    assert.ok(String(prep.__sends[0]!.comment).includes('strictEntryAgg'))
  })
})
