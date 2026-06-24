import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionEngine, type OpenBasketArgs } from './executionEngine'
import { buildOrderComment, type FxOpenOrder, type FxOrderResult } from './fxContract'

type SendCall = { req: Record<string, unknown>; opts: Record<string, unknown> }

function mockFx(opts: {
  snapshot?: FxOpenOrder[]
  onSend?: (req: any, sendOpts: any) => FxOrderResult
}) {
  const sends: SendCall[] = []
  const fx = {
    async openedOrders() { return opts.snapshot ?? [] },
    async orderSend(_acct: string, _plat: string, req: any, sendOpts: any): Promise<FxOrderResult> {
      sends.push({ req, opts: sendOpts })
      return opts.onSend
        ? opts.onSend(req, sendOpts)
        : okResult(900 + sends.length, req.volume, 4078)
    },
    async orderModify() { return okResult(0, 0, 0) },
    async orderClose() { return okResult(0, 0, 0) },
  }
  return { fx, sends }
}

function okResult(ticket: number, volume: number, price: number, extra?: Partial<FxOrderResult>): FxOrderResult {
  return { ok: true, partial: false, retcode: 10009, retcodeName: 'DONE', message: 'Done', ticket, order: ticket, deal: ticket, volume, price, bid: null, ask: null, comment: null, raw: null, ...extra }
}

function baseArgs(over: Partial<OpenBasketArgs> = {}): OpenBasketArgs {
  return {
    accountId: 'acct', platform: 'MT5', anchorSignalId: 'ae1a0f36', brokerSymbol: 'XAUUSD', isBuy: true,
    legs: [
      { legIndex: 0, operation: 'Buy', volume: 0.05, stopLoss: 4065, takeProfit: 4089 },
      { legIndex: 1, operation: 'Buy', volume: 0.05, stopLoss: 4065, takeProfit: 4089 },
    ],
    userId: 'u', brokerAccountId: 'b1', channelId: 'c',
    recordTrade: async () => {},
    ...over,
  }
}

describe('ExecutionEngine.openBasket', () => {
  it('opens every leg PROTECTED at send (SL/TP in the order) and records them', async () => {
    const recorded: number[] = []
    const { fx, sends } = mockFx({})
    const eng = new ExecutionEngine(fx as never)
    const res = await eng.openBasket(baseArgs({ recordTrade: async l => { recorded.push(l.ticket) } }))
    assert.equal(res.fullyOpened, true)
    assert.equal(res.opened.length, 2)
    assert.equal(recorded.length, 2)
    // every send carried SL+TP and the deterministic comment
    for (const s of sends) {
      assert.equal(s.req.stopLoss, 4065)
      assert.equal(s.req.takeProfit, 4089)
      assert.match(String(s.req.comment), /^t:/)
    }
  })

  it('is idempotent: a leg already present (by comment) is adopted, not re-sent', async () => {
    const existing: FxOpenOrder = {
      ticket: 555, symbol: 'XAUUSD', operation: 'Buy', isBuy: true, volume: 0.05, openPrice: 4078,
      stopLoss: 4065, takeProfit: 4089, comment: buildOrderComment('ae1a0f36', 0), magic: 770077, isPending: false,
    }
    const { fx, sends } = mockFx({ snapshot: [existing] })
    const eng = new ExecutionEngine(fx as never)
    const res = await eng.openBasket(baseArgs())
    assert.equal(res.opened.length, 2)
    assert.equal(res.opened.find(o => o.legIndex === 0)?.ticket, 555)
    assert.equal(res.opened.find(o => o.legIndex === 0)?.adopted, true)
    // only leg 1 was actually sent (leg 0 adopted from snapshot)
    assert.equal(sends.length, 1)
    assert.equal(sends[0]!.opts.legIndex, 1)
  })

  it('passes the pre-send snapshot to orderSend for ambiguous recovery', async () => {
    const { fx, sends } = mockFx({ snapshot: [] })
    const eng = new ExecutionEngine(fx as never)
    await eng.openBasket(baseArgs())
    assert.ok(Array.isArray(sends[0]!.opts.preSnapshot))
  })

  it('reports partial failure without aborting the rest of the burst', async () => {
    const { fx } = mockFx({
      onSend: (req, o) => o.legIndex === 0
        ? { ok: false, partial: false, retcode: 10019, retcodeName: 'NO_MONEY', message: 'No money', ticket: null, order: null, deal: null, volume: null, price: null, bid: null, ask: null, comment: null, raw: null }
        : okResult(901, req.volume, 4078),
    })
    const eng = new ExecutionEngine(fx as never)
    const res = await eng.openBasket(baseArgs())
    assert.equal(res.fullyOpened, false)
    assert.equal(res.opened.length, 1)
    assert.equal(res.failed.length, 1)
    assert.equal(res.failed[0]!.retcode, 10019)
  })
})
