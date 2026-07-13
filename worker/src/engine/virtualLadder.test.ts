import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decideLadderFires, fireLadderLegs, type LadderLeg } from './virtualLadder'
import type { FxOrderResult } from './fxContract'

const legs: LadderLeg[] = [
  { id: 'a', stepIdx: 1, triggerPrice: 4070, volume: 0.05 },
  { id: 'b', stepIdx: 2, triggerPrice: 4060, volume: 0.05 },
  { id: 'c', stepIdx: 3, triggerPrice: 4050, volume: 0.05 },
]

describe('decideLadderFires', () => {
  it('fires only legs whose trigger price was crossed (buy = ask <= trigger), shallowest first', () => {
    const out = decideLadderFires({ legs, bid: 4058.8, ask: 4059, isBuy: true, openLegCount: 0, maxLegs: 10, frozen: false })
    assert.deepEqual(out.map(l => l.id), ['a', 'b'], '4070 and 4060 crossed at ask 4059; 4050 not yet')
  })

  it('returns nothing when frozen (TP touched)', () => {
    assert.equal(decideLadderFires({ legs, bid: 4040, ask: 4040, isBuy: true, openLegCount: 0, maxLegs: 10, frozen: true }).length, 0)
  })

  it('enforces the hard leg cap', () => {
    const out = decideLadderFires({ legs, bid: 4040, ask: 4040, isBuy: true, openLegCount: 9, maxLegs: 10, frozen: false })
    assert.equal(out.length, 1, 'only 1 slot left under the cap')
  })

  it('caps fires per tick when anchor/step not provided (legacy)', () => {
    const out = decideLadderFires({ legs, bid: 4040, ask: 4040, isBuy: true, openLegCount: 0, maxLegs: 10, frozen: false, maxFiresPerTick: 2 })
    assert.equal(out.length, 2)
  })

  it('distance-scaled burst fires all crossed rungs within budget', () => {
    const out = decideLadderFires({
      legs,
      bid: 4040,
      ask: 4040,
      isBuy: true,
      openLegCount: 0,
      maxLegs: 10,
      frozen: false,
      anchor: 4072,
      stepPriceOffset: 10,
    })
    assert.equal(out.length, 3, '4072-4040=320, budget=32 but only 3 legs exist')
    assert.deepEqual(out.map(l => l.id), ['a', 'b', 'c'])
  })

  it('distance-scaled burst near anchor fires only shallowest crossed', () => {
    const out = decideLadderFires({
      legs,
      bid: 4058.8,
      ask: 4059,
      isBuy: true,
      openLegCount: 0,
      maxLegs: 10,
      frozen: false,
      anchor: 4072,
      stepPriceOffset: 10,
    })
    assert.deepEqual(out.map(l => l.id), ['a'])
  })

  it('sell side fires when bid >= trigger', () => {
    const sell: LadderLeg[] = [{ id: 's1', stepIdx: 1, triggerPrice: 4080, volume: 0.05 }]
    assert.equal(decideLadderFires({ legs: sell, bid: 4085, ask: 4085.2, isBuy: false, openLegCount: 0, maxLegs: 10, frozen: false }).length, 1)
  })
})

function res(over: Partial<FxOrderResult>): FxOrderResult {
  return { ok: false, partial: false, retcode: null, retcodeName: 'ERROR', message: '', ticket: null, order: null, deal: null, volume: null, price: null, bid: null, ask: null, comment: null, raw: null, ...over }
}

describe('fireLadderLegs (idempotent)', () => {
  it('fires a claimed leg once and records it', async () => {
    const onFired: string[] = []
    const fx = { async orderSend(): Promise<FxOrderResult> { return res({ ok: true, retcode: 10009, retcodeName: 'DONE', ticket: 123, volume: 0.05, price: 4070 }) } }
    const r = await fireLadderLegs({
      fx: fx as never, accountId: 'a', platform: 'MT5', brokerSymbol: 'XAUUSD', isBuy: true,
      anchorSignalId: 'sig', desiredStopLoss: 4040, desiredTakeProfit: 4090,
      claim: async () => true, onFired: async (id) => { onFired.push(id) }, release: async () => {}, preSnapshot: [],
    }, [legs[0]!])
    assert.equal(r.fired, 1)
    assert.deepEqual(onFired, ['a'])
  })

  it('skips a leg already claimed by another worker (no double-fire)', async () => {
    let sends = 0
    const fx = { async orderSend(): Promise<FxOrderResult> { sends++; return res({ ok: true, retcode: 10009, retcodeName: 'DONE', ticket: 1 }) } }
    const r = await fireLadderLegs({
      fx: fx as never, accountId: 'a', platform: 'MT5', brokerSymbol: 'XAUUSD', isBuy: true,
      anchorSignalId: 'sig', desiredStopLoss: null, desiredTakeProfit: null,
      claim: async () => false, onFired: async () => {}, release: async () => {}, preSnapshot: [],
    }, [legs[0]!])
    assert.equal(r.skipped, 1)
    assert.equal(sends, 0, 'never sent because claim was lost')
  })

  it('on AMBIGUOUS send does NOT release the claim (prevents duplicate re-fire)', async () => {
    let released = 0
    const fx = { async orderSend(): Promise<FxOrderResult> { return res({ retcodeName: 'AMBIGUOUS', message: 'ambiguous' }) } }
    const r = await fireLadderLegs({
      fx: fx as never, accountId: 'a', platform: 'MT5', brokerSymbol: 'XAUUSD', isBuy: true,
      anchorSignalId: 'sig', desiredStopLoss: null, desiredTakeProfit: null,
      claim: async () => true, onFired: async () => {}, release: async () => { released++ }, preSnapshot: [],
    }, [legs[0]!])
    assert.equal(r.failed, 1)
    assert.equal(released, 0, 'ambiguous must not release -> no duplicate fire')
  })

  it('releases the claim on a definite not-placed failure (safe to retry later)', async () => {
    let released = 0
    const fx = { async orderSend(): Promise<FxOrderResult> { return res({ retcodeName: 'NO_MONEY', retcode: 10019 }) } }
    const r = await fireLadderLegs({
      fx: fx as never, accountId: 'a', platform: 'MT5', brokerSymbol: 'XAUUSD', isBuy: true,
      anchorSignalId: 'sig', desiredStopLoss: null, desiredTakeProfit: null,
      claim: async () => true, onFired: async () => {}, release: async () => { released++ }, preSnapshot: [],
    }, [legs[0]!])
    assert.equal(r.failed, 1)
    assert.equal(released, 1)
  })
})
