import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadBasketSlTpTarget, upsertBasketSlTpTarget } from './basketTargetStore'

type Row = { stoploss: number | null; tp_levels: unknown; source: string; updated_at: string | null }

function mockSupabase(existing: Row | null) {
  const captured: { upserts: Record<string, unknown>[] } = { upserts: [] }
  const supabase = {
    from() {
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = self
      b.eq = self
      b.maybeSingle = () => Promise.resolve({ data: existing, error: null })
      b.upsert = (row: Record<string, unknown>) => {
        captured.upserts.push(row)
        return Promise.resolve({ error: null })
      }
      return b
    },
  }
  return { supabase, captured }
}

describe('basketTargetStore', () => {
  it('loads and normalizes a stored target', async () => {
    const { supabase } = mockSupabase({
      stoploss: 4090,
      tp_levels: [4265, 4280, '0', -1],
      source: 'adjust',
      updated_at: '2026-06-17T14:00:00Z',
    })
    const t = await loadBasketSlTpTarget(supabase as never, 'broker-1', 'sig')
    assert.equal(t?.stoploss, 4090)
    assert.deepEqual(t?.tpLevels, [4265, 4280], 'drops non-positive TP levels')
    assert.equal(t?.source, 'adjust')
  })

  it('breakeven (SL only) keeps the existing TP ladder (merge)', async () => {
    const { supabase, captured } = mockSupabase({
      stoploss: 4100,
      tp_levels: [4265, 4280],
      source: 'adjust',
      updated_at: '2026-06-17T12:00:00Z',
    })
    await upsertBasketSlTpTarget(supabase as never, {
      userId: 'u',
      brokerAccountId: 'broker-1',
      anchorSignalId: 'sig',
      channelId: 'c',
      symbol: 'XAUUSD',
      stoploss: 4150,
      source: 'breakeven',
    })
    assert.equal(captured.upserts.length, 1)
    const row = captured.upserts[0]!
    assert.equal(row.stoploss, 4150, 'latest SL wins')
    assert.deepEqual(row.tp_levels, [4265, 4280], 'existing TP preserved when not supplied')
    assert.equal(row.source, 'breakeven')
  })

  it('adjust with new TP only keeps the existing SL (merge)', async () => {
    const { supabase, captured } = mockSupabase({
      stoploss: 4150,
      tp_levels: [4265],
      source: 'breakeven',
      updated_at: '2026-06-17T12:00:00Z',
    })
    await upsertBasketSlTpTarget(supabase as never, {
      userId: 'u',
      brokerAccountId: 'broker-1',
      anchorSignalId: 'sig',
      channelId: 'c',
      symbol: 'XAUUSD',
      tpLevels: [4270, 4290],
      source: 'adjust',
    })
    const row = captured.upserts[0]!
    assert.equal(row.stoploss, 4150, 'existing SL preserved when not supplied')
    assert.deepEqual(row.tp_levels, [4270, 4290], 'latest TP wins')
  })

  it('does not write when neither SL nor TP is provided', async () => {
    const { supabase, captured } = mockSupabase(null)
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
    assert.equal(captured.upserts.length, 0)
  })
})
