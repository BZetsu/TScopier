/**
 * Regression tests for incident 2026-11-18: a new entry that carries a stop loss or take
 * profit was discarded when the channel had "ignore SL/TP changes" enabled, because the
 * filter was consulted before anything proved an open basket existed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tryTeaserCompletionMerge } from './mergeRouting'
import type { BrokerRow, ParsedSignal, SignalRow } from '../types'

const CHANNEL = 'ch-1'
const BROKER_ID = 'broker-1'
const USER_ID = 'user-1'
const ANCHOR_SIGNAL = 'anchor-signal'

interface Logged {
  table: string
  payload?: Record<string, unknown>
}

const ANCHOR_LEG = {
  id: 'leg-1',
  signal_id: ANCHOR_SIGNAL,
  metaapi_order_id: '1001',
  opened_at: '2026-11-18T07:59:00Z',
  lot_size: 0.01,
  sl: null,
  tp: null,
  entry_price: 3838.5,
  direction: 'sell',
  symbol: 'XAUUSD.s',
}

/**
 * Stubs the narrow set of queries this path makes. Each shape is keyed by the selected
 * columns, because the same table is queried with different projections.
 */
function makeSupabase(opts: { openLegs: boolean; recentSignalAnchor: boolean }): {
  client: never
  logged: Logged[]
} {
  const logged: Logged[] = []

  const rowsFor = (table: string, cols: string): unknown => {
    if (table === 'trades') {
      if (cols.includes('metaapi_order_id')) return opts.openLegs ? [ANCHOR_LEG] : []
      // Anchor lookup: the open-basket query.
      return opts.openLegs
        ? [{ signal_id: ANCHOR_SIGNAL, opened_at: ANCHOR_LEG.opened_at, symbol: ANCHOR_LEG.symbol }]
        : []
    }
    if (table === 'signals') {
      if (cols.trim() === 'id, channel_id') {
        return opts.recentSignalAnchor ? [{ id: ANCHOR_SIGNAL, channel_id: CHANNEL }] : []
      }
      if (cols.trim() === 'parsed_data') {
        // A settleable teaser anchor: an entry with no stops and no entry price.
        return { parsed_data: { action: 'sell', symbol: 'XAUUSD' } }
      }
      if (cols.includes('telegram_message_id, channel_id')) {
        return { telegram_message_id: '1099', channel_id: CHANNEL }
      }
      if (cols.includes('reply_to_message_id')) {
        return { created_at: '2026-11-18T07:59:00Z', reply_to_message_id: null }
      }
      return []
    }
    return null
  }

  const chain = (table: string): never => {
    let cols = ''
    const builder: Record<string, unknown> = {
      select: (value: string) => {
        cols = String(value)
        return builder
      },
      eq: () => builder,
      in: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      insert: (payload: Record<string, unknown>) => {
        logged.push({ table, payload })
        return builder
      },
      update: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rowsFor(table, cols), error: null }).then(resolve),
    }
    return builder as never
  }

  return { client: { from: chain } as never, logged }
}

function filters(value: 'ignore' | 'allow'): Record<string, unknown> {
  return {
    [CHANNEL]: {
      reverse: 'allow',
      close_all: 'allow',
      modify_sl: value,
      modify_tp: value,
      break_even: 'allow',
      close_full: 'allow',
      close_half: 'allow',
      close_tp_levels: 'allow',
      delete_pendings: 'allow',
      close_worse_entries: 'allow',
    },
  }
}

function broker(filterValue: 'ignore' | 'allow'): BrokerRow {
  return {
    id: BROKER_ID,
    user_id: USER_ID,
    platform: 'MT5',
    provider: 'mtapi',
    copier_mode: 'manual',
    manual_settings: { trade_style: 'single', fixed_lot: 0.01 },
    channel_message_filters: filters(filterValue),
  } as unknown as BrokerRow
}

const parsed = {
  action: 'sell',
  symbol: 'XAUUSD',
  sl: 3776.93,
  tp: [3749.22],
  open_tp: false,
  sl_unit: 'price',
  tp_unit: 'price',
  entry_price: null,
  entry_zone_low: null,
  entry_zone_high: null,
  raw_instruction: 'Xauusd sell now\nSl 3776.93\nTp 3749.22',
} as unknown as ParsedSignal

const signal = {
  id: 'signal-1',
  user_id: USER_ID,
  channel_id: CHANNEL,
  created_at: '2026-11-18T08:00:41Z',
  telegram_message_id: '1115',
  reply_to_message_id: null,
  parent_signal_id: null,
  parsed_data: parsed,
} as unknown as SignalRow

function args(filterValue: 'ignore' | 'allow') {
  return {
    signal,
    parsed,
    broker: broker(filterValue),
    channelKeywords: null,
    baseLot: 0.01,
    params: null,
    symbol: 'XAUUSD.s',
    uuid: 'uuid-1',
    strictEntryPrefetch: { bid: 3838.9, ask: 3839.2 },
    commentPrefix: 'UniCopier:TEST',
    liveEntryFast: true,
  }
}

test('a new entry with stops opens even when the channel ignores SL/TP changes', async () => {
  // No open basket and no recent-signal anchor — the production situation for the reporter.
  const { client } = makeSupabase({ openLegs: false, recentSignalAnchor: false })
  const ctx = { supabase: client, apiFor: () => null } as never

  const outcome = await tryTeaserCompletionMerge(ctx, args('ignore'))

  assert.deepEqual(outcome, { handled: false })
})

test('a recent-signal anchor with no open legs still opens the entry', async () => {
  // The reporter's channel re-posts within 10 minutes; the anchor comes from the signals table
  // alone, which proves nothing about an open trade.
  const { client } = makeSupabase({ openLegs: false, recentSignalAnchor: true })
  const ctx = { supabase: client, apiFor: () => null } as never

  const outcome = await tryTeaserCompletionMerge(ctx, args('ignore'))

  assert.equal(outcome.handled, false)
})

test('the filter still suppresses a real teaser completion and records why', async () => {
  // Open legs exist, so the message would modify them — the setting must still apply.
  const { client, logged } = makeSupabase({ openLegs: true, recentSignalAnchor: true })
  const ctx = { supabase: client, apiFor: () => null } as never

  const outcome = await tryTeaserCompletionMerge(ctx, args('ignore'))

  assert.equal(outcome.handled, true)
  assert.equal((outcome as { success?: boolean }).success, false)
  assert.equal(
    (outcome as { failureReason?: string }).failureReason,
    'basket_modify_skipped_by_channel_filter',
  )

  const logRow = logged.find(entry => entry.table === 'trade_execution_logs')
  assert.ok(logRow, 'the skip must be written to trade_execution_logs')
  assert.equal((logRow!.payload as Record<string, unknown>).status, 'skipped')
  assert.equal(
    ((logRow!.payload as Record<string, unknown>).request_payload as Record<string, unknown>).skip_reason,
    'channel_filter_ignored',
  )
})
