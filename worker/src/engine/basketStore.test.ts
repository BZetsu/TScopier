import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadDesiredBasket, resolveLegTargets, setDesiredBasket } from './basketStore'

function mockLoad(row: Record<string, unknown> | null) {
  return {
    from() {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self; b.eq = self
      b.maybeSingle = () => Promise.resolve({ data: row, error: null })
      return b
    },
  }
}
function mockRpc() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  return {
    calls,
    rpc(name: string, params: Record<string, unknown>) { calls.push({ name, params }); return Promise.resolve({ error: null }) },
  }
}

describe('basketStore.loadDesiredBasket', () => {
  it('reads + normalizes a row, preferring instruction_at', async () => {
    const sb = mockLoad({ symbol: 'XAUUSD', stoploss: 4090, tp_levels: [4083, 4086, 0, -1], source: 'adjust', instruction_at: '2026-06-24T14:00:00Z', updated_at: '2026-06-24T14:05:00Z' })
    const d = await loadDesiredBasket(sb as never, 'b1', 'sig')
    assert.equal(d?.stoploss, 4090)
    assert.deepEqual(d?.tpLevels, [4083, 4086])
    assert.equal(d?.instructionAt, '2026-06-24T14:00:00Z')
  })
  it('returns null when absent', async () => {
    assert.equal(await loadDesiredBasket(mockLoad(null) as never, 'b1', 'sig'), null)
  })
})

describe('basketStore.setDesiredBasket', () => {
  it('calls the atomic RPC with instruction time', async () => {
    const sb = mockRpc()
    await setDesiredBasket(sb as never, { userId: 'u', brokerAccountId: 'b1', anchorSignalId: 'sig', channelId: 'c', symbol: 'XAUUSD', stoploss: 4090, source: 'adjust', instructionAt: '2026-06-24T14:00:00Z' })
    assert.equal(sb.calls[0]!.name, 'upsert_basket_sl_tp_target')
    assert.equal(sb.calls[0]!.params.p_stoploss, 4090)
    assert.equal(sb.calls[0]!.params.p_instruction_at, '2026-06-24T14:00:00Z')
  })
  it('no-ops when neither SL nor TP supplied', async () => {
    const sb = mockRpc()
    await setDesiredBasket(sb as never, { userId: 'u', brokerAccountId: 'b1', anchorSignalId: 'sig', channelId: null, symbol: 'XAUUSD', stoploss: 0, tpLevels: [], source: 'adjust' })
    assert.equal(sb.calls.length, 0)
  })
})

describe('basketStore.resolveLegTargets', () => {
  const desired = { brokerAccountId: 'b1', anchorSignalId: 'sig', symbol: 'XAUUSD', stoploss: 4090, tpLevels: [4083, 4086], source: 'adjust', instructionAt: '2026-06-24T12:00:00Z' }
  it('uses the desired row as authoritative', () => {
    const r = resolveLegTargets({ desired, isBuy: true })
    assert.equal(r.stoploss, 4090)
    assert.deepEqual(r.tpLevels, [4083, 4086])
    assert.equal(r.source, 'adjust')
  })
  it('honors a newer auto-breakeven over a stale desired adjust', () => {
    const r = resolveLegTargets({ desired, autoBeAt: '2026-06-24T13:00:00Z', autoBeSl: 4150, isBuy: true })
    assert.equal(r.stoploss, 4150)
    assert.equal(r.source, 'auto_breakeven')
  })
  it('falls back to anchor when no desired row', () => {
    const r = resolveLegTargets({ desired: null, anchorSl: 4100, anchorTps: [4120], isBuy: true })
    assert.equal(r.stoploss, 4100)
    assert.deepEqual(r.tpLevels, [4120])
    assert.equal(r.source, 'anchor')
  })
})
