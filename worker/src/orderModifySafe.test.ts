import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isInvalidStopsError, modifyLegSlTpWithFallback } from './orderModifySafe'

type Call = { ticket: number; stoploss?: number; takeprofit?: number }

/**
 * Mock broker. `behavior(call)` returns 'ok' | 'invalid' | 'timeout' | 'benign'.
 */
function mockApi(behavior: (call: Call) => 'ok' | 'invalid' | 'timeout' | 'benign') {
  const calls: Call[] = []
  return {
    calls,
    async orderModify(_uuid: string, args: Call) {
      calls.push(args)
      const b = behavior(args)
      if (b === 'ok') return { stopLoss: args.stoploss ?? null, takeProfit: args.takeprofit ?? null }
      if (b === 'benign') throw new Error('Order already have this parameters (:52886408)')
      if (b === 'timeout') throw new Error('TradingHelper.OrderModify timed out')
      throw new Error('Invalid stops')
    },
  }
}

describe('isInvalidStopsError', () => {
  it('matches broker invalid-stops phrasings', () => {
    assert.equal(isInvalidStopsError('Invalid stops'), true)
    assert.equal(isInvalidStopsError('Invalid S/L'), true)
    assert.equal(isInvalidStopsError('stops too close'), true)
    assert.equal(isInvalidStopsError('TradingHelper.OrderModify timed out'), false)
    assert.equal(isInvalidStopsError('unknown ticket'), false)
    assert.equal(isInvalidStopsError(''), false)
  })
})

describe('modifyLegSlTpWithFallback', () => {
  it('applies SL+TP in one call when the broker accepts it', async () => {
    const api = mockApi(() => 'ok')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4089)
    assert.equal(out.ok, true)
    assert.equal(out.mode, 'combined')
    assert.equal(out.slApplied, true)
    assert.equal(out.tpApplied, true)
    assert.equal(api.calls.length, 1)
  })

  it('on invalid stops, protects SL and defers the bad TP', async () => {
    // Combined fails invalid; SL-only ok; TP-only invalid (price passed it).
    const api = mockApi(call =>
      call.stoploss != null && call.takeprofit != null
        ? 'invalid'
        : call.takeprofit != null
          ? 'invalid'
          : 'ok',
    )
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4083)
    assert.equal(out.ok, true, 'SL landed -> overall ok')
    assert.equal(out.mode, 'split')
    assert.equal(out.slApplied, true, 'protective SL applied')
    assert.equal(out.tpApplied, false, 'invalid TP deferred, not blocking SL')
    assert.equal(api.calls.length, 3, 'combined + SL-only + TP-only')
  })

  it('reassigns the deepest ladder TP when the requested TP was passed by price', async () => {
    // Combined invalid; SL-only ok; requested TP 4083 invalid (passed); deepest 4089 ok.
    const api = mockApi(call => {
      if (call.stoploss != null && call.takeprofit != null) return 'invalid'
      if (call.stoploss != null) return 'ok'
      if (call.takeprofit === 4083) return 'invalid'
      return 'ok'
    })
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4083, { deepestTp: 4089 })
    assert.equal(out.ok, true)
    assert.equal(out.slApplied, true)
    assert.equal(out.tpApplied, true, 'TP landed on the deepest valid level')
    assert.equal(out.appliedTp, 4089, 'reassigned to the deepest ladder TP')
    assert.equal(out.appliedSl, 4065)
    assert.equal(api.calls.length, 4, 'combined + SL-only + TP(4083) + TP(4089)')
  })

  it('defers TP only when even the deepest ladder TP is rejected', async () => {
    const api = mockApi(call => (call.takeprofit != null ? 'invalid' : 'ok'))
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4083, { deepestTp: 4089 })
    assert.equal(out.ok, true, 'SL still protected')
    assert.equal(out.slApplied, true)
    assert.equal(out.tpApplied, false)
    assert.equal(out.appliedTp, 0)
  })

  it('reports failure when even the SL cannot be applied', async () => {
    const api = mockApi(() => 'invalid')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4083)
    assert.equal(out.ok, false)
    assert.equal(out.slApplied, false)
    assert.ok(out.error)
  })

  it('does NOT split on a timeout (returns the error for transient handling)', async () => {
    const api = mockApi(() => 'timeout')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4089)
    assert.equal(out.ok, false)
    assert.equal(out.mode, 'combined')
    assert.equal(api.calls.length, 1, 'no split retries for a timeout')
    assert.match(out.error ?? '', /timed out/)
  })

  it('treats a benign "already has parameters" as success', async () => {
    const api = mockApi(() => 'benign')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 4089)
    assert.equal(out.ok, true)
    assert.equal(out.slApplied, true)
    assert.equal(api.calls.length, 1)
  })

  it('SL-only request never sends a TP', async () => {
    const api = mockApi(() => 'ok')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 4065, 0)
    assert.equal(out.ok, true)
    assert.equal(out.slApplied, true)
    assert.equal(out.tpApplied, false)
    assert.equal(api.calls[0]!.takeprofit, undefined)
  })

  it('no-op when neither SL nor TP is provided', async () => {
    const api = mockApi(() => 'ok')
    const out = await modifyLegSlTpWithFallback(api, 'u', 111, 0, 0)
    assert.equal(out.ok, false)
    assert.equal(out.mode, 'none')
    assert.equal(api.calls.length, 0)
  })
})
