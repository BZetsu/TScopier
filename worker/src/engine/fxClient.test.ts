import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FxClient, FxHttpError, type FxTransport, type FxTransportResponse } from './fxClient'

type Handler = (req: { method: string; url: string; body: unknown }) => FxTransportResponse | Promise<FxTransportResponse>

function mockTransport(handler: Handler) {
  const calls: Array<{ method: string; endpoint: string; body: unknown }> = []
  const transport: FxTransport = async (req) => {
    const endpoint = req.url.split('?')[0].split('/').pop() ?? ''
    const body = req.body ? JSON.parse(req.body) : undefined
    calls.push({ method: req.method, endpoint, body })
    return handler({ method: req.method, url: req.url, body })
  }
  return { transport, calls }
}

const SEND_OPTS = { anchorSignalId: 'ae1a0f36-ab01-4380-96fe-0fe5addaeafe', legIndex: 1 }
const REQ = { symbol: 'XAUUSD', operation: 'Buy' as const, volume: 0.1, stopLoss: 4065, takeProfit: 4089 }

describe('FxClient.orderSend', () => {
  it('returns ok with ticket on a DONE response and attaches SL/TP + comment', async () => {
    const { transport, calls } = mockTransport(() => ({ status: 200, body: { success: true, retcode: 10009, order: 555, price: 4078 } }))
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, SEND_OPTS)
    assert.equal(r.ok, true)
    assert.equal(r.ticket, 555)
    const sent = calls[0]!.body as Record<string, unknown>
    assert.equal(sent.stopLoss, 4065)
    assert.equal(sent.takeProfit, 4089)
    assert.match(String(sent.comment), /^t:/)
    assert.ok(typeof sent.expertId === 'number')
  })

  it('rejects without duplicate recovery on a definite not-placed retcode (INVALID_STOPS)', async () => {
    const { transport, calls } = mockTransport(() => ({ status: 200, body: { retcode: 10016, retcodeDescription: 'Invalid stops' } }))
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, SEND_OPTS)
    assert.equal(r.ok, false)
    assert.equal(r.retcodeName, 'INVALID_STOPS')
    assert.equal(calls.filter(c => c.endpoint === 'OrderSend').length, 1)
    assert.equal(calls.filter(c => c.endpoint === 'OpenedOrders').length, 0)
  })

  it('NEVER re-sends on an ambiguous timeout; adopts the matching opened order', async () => {
    let sends = 0
    const { transport, calls } = mockTransport((req) => {
      if (req.url.includes('/OrderSend')) {
        sends++
        throw new Error('TradingHelper.OrderSend timed out')
      }
      // OpenedOrders shows the position actually opened.
      return { status: 200, body: { result: [{ ticket: 999, symbol: 'XAUUSD', type: 'Buy', volume: 0.1, openPrice: 4078, comment: 't:ae1a0f36ab014380:1' }] } }
    })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, SEND_OPTS)
    assert.equal(sends, 1, 'must send exactly once - no blind retry')
    assert.equal(r.ok, true)
    assert.equal(r.ticket, 999, 'adopted the order that actually opened')
    assert.ok(calls.some(c => c.endpoint === 'OpenedOrders'))
  })

  it('reports ambiguous failure (ok=false) when no matching order is found - still no re-send', async () => {
    let sends = 0
    const { transport } = mockTransport((req) => {
      if (req.url.includes('/OrderSend')) { sends++; throw new Error('socket hang up') }
      return { status: 200, body: { result: [] } } // nothing opened
    })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, SEND_OPTS)
    assert.equal(sends, 1)
    assert.equal(r.ok, false)
    assert.equal(r.retcodeName, 'AMBIGUOUS')
  })

  it('does NOT adopt a pre-existing order (only new ones vs preSnapshot)', async () => {
    const { transport } = mockTransport((req) => {
      if (req.url.includes('/OrderSend')) throw new Error('timed out')
      return { status: 200, body: { result: [{ ticket: 100, symbol: 'XAUUSD', type: 'Buy', volume: 0.1, openPrice: 4078 }] } }
    })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, { ...SEND_OPTS, preSnapshot: [{ ticket: 100, symbol: 'XAUUSD', operation: 'Buy', isBuy: true, volume: 0.1, openPrice: 4078, stopLoss: null, takeProfit: null, comment: '', magic: null, isPending: false }] })
    assert.equal(r.ok, false, 'ticket 100 existed before -> not adopted')
  })

  it('returns not-placed (retryable) on a connection-refused transport error', async () => {
    const { transport, calls } = mockTransport(() => { throw new Error('connect ECONNREFUSED 1.2.3.4:443') })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderSend('acct', 'MT5', REQ, SEND_OPTS)
    assert.equal(r.ok, false)
    assert.equal(r.retcodeName, 'NOT_PLACED')
    assert.equal(calls.filter(c => c.endpoint === 'OpenedOrders').length, 0, 'no recovery read needed - definitely not placed')
  })
})

describe('FxClient.orderModify', () => {
  it('treats NO_CHANGES (10025) as success', async () => {
    const { transport } = mockTransport(() => ({ status: 200, body: { retcode: 10025, retcodeDescription: 'No changes' } }))
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderModify('acct', 'MT5', { ticket: 5, stopLoss: 4100 })
    assert.equal(r.ok, true)
  })

  it('retries on an ambiguous timeout (idempotent) then succeeds', async () => {
    let n = 0
    const { transport, calls } = mockTransport(() => {
      n++
      if (n === 1) throw new Error('OrderModify timed out')
      return { status: 200, body: { success: true, retcode: 10009, order: 5 } }
    })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderModify('acct', 'MT5', { ticket: 5, stopLoss: 4100 })
    assert.equal(r.ok, true)
    assert.equal(calls.filter(c => c.endpoint === 'OrderModify').length, 2)
  })
})

describe('FxClient.orderClose', () => {
  it('treats POSITION_CLOSED (10036) as success (already closed)', async () => {
    const { transport } = mockTransport(() => ({ status: 200, body: { retcode: 10036, retcodeDescription: 'Position closed' } }))
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderClose('acct', 'MT5', { ticket: 5 })
    assert.equal(r.ok, true)
  })

  it('confirms close via snapshot when the close call times out and the ticket is gone', async () => {
    const { transport } = mockTransport((req) => {
      if (req.url.includes('/OrderClose')) throw new Error('timed out')
      return { status: 200, body: { result: [] } }
    })
    const fx = new FxClient({ apiKey: 'k', transport })
    const r = await fx.orderClose('acct', 'MT5', { ticket: 5 })
    assert.equal(r.ok, true)
    assert.equal(r.message, 'close confirmed via snapshot')
  })
})

describe('FxHttpError ambiguity classification', () => {
  it('marks 504 as ambiguous but 400 as not', () => {
    assert.equal(new FxHttpError('x', 504, null, true).ambiguous, true)
    assert.equal(new FxHttpError('x', 400, null, false).ambiguous, false)
  })
})
