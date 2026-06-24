import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeWithProtectiveLegSl,
  mostProtectiveOpenLegSl,
  resolveEffectiveBasketStops,
  resolveEffectiveStoplossPriority,
  unanimousLegSl,
  isSlMoreProtective,
} from './basketEffectiveStops'
import type { BasketOpenLeg } from './basketSlTpReconcile'

function mockSupabase(dataByTable: Record<string, unknown[]>) {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = self
    b.eq = self
    b.in = self
    b.gte = self
    b.order = self
    b.limit = () => Promise.resolve({ data: dataByTable[table] ?? [], error: null })
    b.maybeSingle = () => Promise.resolve({ data: (dataByTable[table] ?? [])[0] ?? null, error: null })
    return b
  }
  return { from: (t: string) => builder(t) }
}

function leg(sl: number | null): BasketOpenLeg {
  return {
    id: 't1',
    signal_id: 'sig',
    metaapi_order_id: '1',
    opened_at: '2026-06-17T11:00:00Z',
    lot_size: 0.01,
    sl,
    tp: 4265,
    entry_price: 4255,
    direction: 'buy',
    symbol: 'XAUUSD',
  }
}

describe('resolveEffectiveStoplossPriority', () => {
  it('prefers mgmt signal SL over anchor and channel', () => {
    const r = resolveEffectiveStoplossPriority({
      anchorSl: 4245,
      mgmtSl: 4242,
      channelSl: 4240,
      legConsensus: null,
    })
    assert.equal(r.stoploss, 4242)
    assert.equal(r.source, 'mgmt_signal')
  })

  it('uses channel memory when no mgmt signal', () => {
    const r = resolveEffectiveStoplossPriority({
      anchorSl: 4245,
      mgmtSl: null,
      channelSl: 4242,
      legConsensus: null,
    })
    assert.equal(r.stoploss, 4242)
    assert.equal(r.source, 'channel_memory')
  })

  it('keeps anchor when channel is stale and no mgmt', () => {
    const r = resolveEffectiveStoplossPriority({
      anchorSl: 4245,
      mgmtSl: null,
      channelSl: null,
      legConsensus: null,
    })
    assert.equal(r.stoploss, 4245)
    assert.equal(r.source, 'anchor')
  })

  it('uses leg consensus when channel write failed but legs agree on adjusted SL', () => {
    const r = resolveEffectiveStoplossPriority({
      anchorSl: 4245,
      mgmtSl: null,
      channelSl: null,
      legConsensus: 4242,
    })
    assert.equal(r.stoploss, 4242)
    assert.equal(r.source, 'leg_consensus')
  })
})

describe('unanimousLegSl', () => {
  it('returns shared SL when all legs match', () => {
    assert.equal(unanimousLegSl([leg(4242), leg(4242)]), 4242)
  })

  it('returns null when legs disagree', () => {
    assert.equal(unanimousLegSl([leg(4242), leg(4245)]), null)
  })
})

describe('mostProtectiveOpenLegSl', () => {
  it('returns highest SL for buy legs', () => {
    assert.equal(mostProtectiveOpenLegSl([leg(4242), leg(4248)], true), 4248)
  })

  it('returns lowest SL for sell legs', () => {
    const sellLeg = { ...leg(4248), direction: 'sell' as const }
    const sellLeg2 = { ...leg(4242), direction: 'sell' as const }
    assert.equal(mostProtectiveOpenLegSl([sellLeg, sellLeg2], false), 4242)
  })
})

describe('mergeWithProtectiveLegSl', () => {
  it('keeps tighter leg SL over anchor for buys', () => {
    assert.equal(mergeWithProtectiveLegSl(4245, 4248, true), 4248)
  })
})

describe('isSlMoreProtective', () => {
  it('detects buy leg SL above target', () => {
    assert.equal(isSlMoreProtective(4248, 4245, true), true)
    assert.equal(isSlMoreProtective(4245, 4248, true), false)
  })
})

describe('resolveEffectiveBasketStops explicit-adjustment wins', () => {
  it('a loosening mgmt adjust is NOT overridden by a tighter open-leg SL', async () => {
    const supabase = mockSupabase({
      signals: [
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4155, symbol: null }, created_at: '2026-06-17T12:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4258), leg(4258)],
    })
    assert.equal(eff.source, 'mgmt_signal')
    assert.equal(eff.stoploss, 4155, 'explicit channel adjust wins, not the tighter 4258 leg SL')
  })

  it('keeps breakeven SL when a breakeven happened AFTER an older Adjust SL', async () => {
    // Older "Adjust SL to 4100" then a newer "Move SL to breakeven" (legs at 4150).
    const supabase = mockSupabase({
      signals: [
        { id: 'be-1', parsed_data: { action: 'breakeven', sl: null, symbol: null }, created_at: '2026-06-17T13:00:00Z' },
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4100, symbol: null }, created_at: '2026-06-17T12:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4150), leg(4150)],
    })
    assert.notEqual(eff.source, 'mgmt_signal', 'stale adjust must not be authoritative after a breakeven')
    assert.equal(eff.stoploss, 4150, 'breakeven SL preserved, not reverted to the older 4100 adjust')
  })

  it('keeps AUTO-breakeven SL (no signal) when it is newer than an older Adjust SL', async () => {
    // Auto-BE leaves no signal/channel memory — only trades.auto_be_applied_at.
    const supabase = mockSupabase({
      signals: [
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4100, symbol: null }, created_at: '2026-06-17T12:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const beLeg = (sl: number) => ({ ...leg(sl), auto_be_applied_at: '2026-06-17T13:00:00Z' })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [beLeg(4150), beLeg(4150)],
    })
    assert.notEqual(eff.source, 'mgmt_signal', 'stale adjust must not override a newer auto-breakeven')
    assert.equal(eff.stoploss, 4150, 'auto-breakeven SL preserved, not reverted to 4100')
  })

  it('lets the Adjust SL win when it is newer than the auto-breakeven', async () => {
    const supabase = mockSupabase({
      signals: [
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4090, symbol: null }, created_at: '2026-06-17T14:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const beLeg = (sl: number) => ({ ...leg(sl), auto_be_applied_at: '2026-06-17T13:00:00Z' })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [beLeg(4150), beLeg(4150)],
    })
    assert.equal(eff.source, 'mgmt_signal')
    assert.equal(eff.stoploss, 4090, 'newer adjust wins over the older auto-breakeven')
  })

  it('lets a newer Adjust SL win (loosen) when it came AFTER the breakeven', async () => {
    const supabase = mockSupabase({
      signals: [
        { id: 'mod-2', parsed_data: { action: 'modify', sl: 4090, symbol: null }, created_at: '2026-06-17T14:00:00Z' },
        { id: 'be-1', parsed_data: { action: 'breakeven', sl: null, symbol: null }, created_at: '2026-06-17T13:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4150), leg(4150)],
    })
    assert.equal(eff.source, 'mgmt_signal')
    assert.equal(eff.stoploss, 4090, 'newest adjust wins even though it loosens off breakeven')
  })

  it('non-mgmt source (channel memory) still merges the most-protective leg SL', async () => {
    const supabase = mockSupabase({
      signals: [],
      channel_active_trade_params: [
        { symbol: 'XAUUSD', stoploss: 4150, tp_levels: [4265], updated_at: '2026-06-17T12:00:00Z' },
      ],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4258), leg(4258)],
    })
    assert.equal(eff.source, 'channel_memory')
    assert.equal(eff.stoploss, 4258, 'protective merge still applies for non-explicit sources')
  })
})

describe('resolveEffectiveBasketStops per-basket target store', () => {
  it('uses the basket target as the authoritative SL/TP (skips protective merge)', async () => {
    const supabase = mockSupabase({
      basket_sl_tp_targets: [
        { stoploss: 4090, tp_levels: [4280], source: 'adjust', updated_at: '2026-06-17T14:00:00Z' },
      ],
      // A stale older mgmt adjust + tighter open legs must NOT win.
      signals: [
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4155, symbol: null }, created_at: '2026-06-17T12:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4258), leg(4258)],
      brokerAccountId: 'broker-1',
    })
    assert.equal(eff.source, 'basket_target', 'basket target is the single source of truth')
    assert.equal(eff.stoploss, 4090, 'basket target SL wins over older adjust and tighter leg SL')
    assert.deepEqual(eff.tpLevels, [4280], 'basket target TP wins')
  })

  it('keeps a newer auto-breakeven over an older basket target (no revert after TP hit)', async () => {
    const supabase = mockSupabase({
      basket_sl_tp_targets: [
        { stoploss: 4100, tp_levels: [4265], source: 'adjust', updated_at: '2026-06-17T12:00:00Z' },
      ],
      signals: [],
      channel_active_trade_params: [],
    })
    const beLeg = (sl: number) => ({ ...leg(sl), auto_be_applied_at: '2026-06-17T13:00:00Z' })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [beLeg(4150), beLeg(4150)],
      brokerAccountId: 'broker-1',
    })
    assert.notEqual(eff.source, 'basket_target', 'stale target must not override a newer auto-breakeven')
    assert.equal(eff.stoploss, 4150, 'auto-breakeven SL preserved, not reverted to the 4100 target')
  })

  it('falls back to existing logic when no basket target row exists', async () => {
    const supabase = mockSupabase({
      basket_sl_tp_targets: [],
      signals: [
        { id: 'mod-1', parsed_data: { action: 'modify', sl: 4155, symbol: null }, created_at: '2026-06-17T12:00:00Z' },
      ],
      channel_active_trade_params: [],
    })
    const eff = await resolveEffectiveBasketStops({
      supabase: supabase as never,
      userId: 'u',
      channelId: 'c',
      anchorSignalId: 'sig',
      symbol: 'XAUUSD',
      basketCreatedAt: '2026-06-17T11:00:00Z',
      anchorParsed: { sl: 4100, tp: [4265] },
      familyTrades: [leg(4258), leg(4258)],
      brokerAccountId: 'broker-1',
    })
    assert.equal(eff.source, 'mgmt_signal', 'absent target -> existing resolver behavior')
    assert.equal(eff.stoploss, 4155)
  })
})
