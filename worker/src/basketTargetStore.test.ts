import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findStaleBasketKeys, loadBasketSlTpTarget, upsertBasketSlTpTarget } from './basketTargetStore'

type Row = {
  stoploss: number | null
  tp_levels: unknown
  source: string
  updated_at: string | null
  instruction_at: string | null
}

function mockLoadSupabase(existing: Row | null) {
  return {
    from() {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self
      b.eq = self
      b.maybeSingle = () => Promise.resolve({ data: existing, error: null })
      return b
    },
  }
}

function mockRpcSupabase() {
  const captured: { calls: Array<{ name: string; params: Record<string, unknown> }> } = { calls: [] }
  const supabase = {
    rpc(name: string, params: Record<string, unknown>) {
      captured.calls.push({ name, params })
      return Promise.resolve({ error: null })
    },
  }
  return { supabase, captured }
}

describe('basketTargetStore', () => {
  it('loads and normalizes a stored target (instruction_at preferred)', async () => {
    const supabase = mockLoadSupabase({
      stoploss: 4090,
      tp_levels: [4265, 4280, '0', -1],
      source: 'adjust',
      updated_at: '2026-06-17T14:05:00Z',
      instruction_at: '2026-06-17T14:00:00Z',
    })
    const t = await loadBasketSlTpTarget(supabase as never, 'broker-1', 'sig')
    assert.equal(t?.stoploss, 4090)
    assert.deepEqual(t?.tpLevels, [4265, 4280], 'drops non-positive TP levels')
    assert.equal(t?.instructionAt, '2026-06-17T14:00:00Z')
  })

  it('falls back instructionAt to updated_at when column is null', async () => {
    const supabase = mockLoadSupabase({
      stoploss: 4090, tp_levels: [], source: 'adjust', updated_at: '2026-06-17T14:05:00Z', instruction_at: null,
    })
    const t = await loadBasketSlTpTarget(supabase as never, 'broker-1', 'sig')
    assert.equal(t?.instructionAt, '2026-06-17T14:05:00Z')
  })

  it('calls the atomic upsert RPC with the instruction timestamp', async () => {
    const { supabase, captured } = mockRpcSupabase()
    await upsertBasketSlTpTarget(supabase as never, {
      userId: 'u',
      brokerAccountId: 'broker-1',
      anchorSignalId: 'sig',
      channelId: 'c',
      symbol: 'XAUUSD',
      stoploss: 4090,
      source: 'adjust',
      instructionAt: '2026-06-24T05:35:42Z',
    })
    assert.equal(captured.calls.length, 1)
    assert.equal(captured.calls[0]!.name, 'upsert_basket_sl_tp_target')
    const p = captured.calls[0]!.params
    assert.equal(p.p_stoploss, 4090)
    assert.equal(p.p_instruction_at, '2026-06-24T05:35:42Z')
    assert.equal(p.p_source, 'adjust')
    assert.equal(p.p_tp_levels, null, 'breakeven/SL-only passes null TP so the DB keeps the ladder')
  })

  it('normalizes TP levels before the RPC', async () => {
    const { supabase, captured } = mockRpcSupabase()
    await upsertBasketSlTpTarget(supabase as never, {
      userId: 'u',
      brokerAccountId: 'broker-1',
      anchorSignalId: 'sig',
      channelId: 'c',
      symbol: 'XAUUSD',
      tpLevels: [4270, 0, -5, 4290],
      source: 'adjust',
    })
    assert.deepEqual(captured.calls[0]!.params.p_tp_levels, [4270, 4290])
  })

  it('flags baskets whose recorded instruction is newer than the incoming one', async () => {
    // Two baskets. Store rows keyed by broker|anchor with differing instruction_at.
    const rows: Record<string, Row> = {
      'b1|sigA': { stoploss: 4090, tp_levels: [], source: 'adjust', updated_at: null, instruction_at: '2026-06-24T05:39:14Z' },
      'b1|sigB': { stoploss: 4090, tp_levels: [], source: 'adjust', updated_at: null, instruction_at: '2026-06-24T05:30:00Z' },
    }
    let lastKey = ''
    const supabase = {
      from() {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = (_col: string, val: string) => {
          if (val === 'b1') lastKey = 'b1|'
          else lastKey += val
          return b
        }
        b.maybeSingle = () => Promise.resolve({ data: rows[lastKey] ?? null, error: null })
        return b
      },
    }
    // Incoming "Adjust SL to 4090" at 05:35:42 — older than sigA's breakeven (05:39),
    // newer than sigB (05:30).
    const stale = await findStaleBasketKeys(
      supabase as never,
      ['b1|sigA', 'b1|sigB'],
      '2026-06-24T05:35:42Z',
    )
    assert.ok(stale.has('b1|sigA'), 'basket with a newer recorded instruction is stale')
    assert.ok(!stale.has('b1|sigB'), 'basket with an older recorded instruction is applied')
  })

  it('flags nothing when the instruction timestamp is missing', async () => {
    const supabase = { from() { return { select: () => ({}) } } }
    const stale = await findStaleBasketKeys(supabase as never, ['b1|sigA'], null)
    assert.equal(stale.size, 0)
  })

  it('does not call the RPC when neither SL nor TP is provided', async () => {
    const { supabase, captured } = mockRpcSupabase()
    await upsertBasketSlTpTarget(supabase as never, {
      userId: 'u',
      brokerAccountId: 'broker-1',
      anchorSignalId: 'sig',
      channelId: 'c',
      symbol: 'XAUUSD',
      stoploss: 0,
      tpLevels: [],
      source: 'adjust',
    })
    assert.equal(captured.calls.length, 0)
  })
})
