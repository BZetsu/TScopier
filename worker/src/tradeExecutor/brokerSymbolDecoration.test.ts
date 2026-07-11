import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  clearLegacySymbolDecorationIfPresent,
  hasLegacySymbolDecoration,
  stripSymbolDecoration,
} from './brokerSymbolDecoration'
import type { BrokerRow } from './types'

test('hasLegacySymbolDecoration: empty settings', () => {
  assert.equal(hasLegacySymbolDecoration({}), false)
  assert.equal(hasLegacySymbolDecoration({ symbol_prefix: '', symbol_suffix: '' }), false)
})

test('hasLegacySymbolDecoration: prefix suffix or map', () => {
  assert.equal(hasLegacySymbolDecoration({ symbol_suffix: '+' }), true)
  assert.equal(hasLegacySymbolDecoration({ symbol_prefix: '#' }), true)
  assert.equal(hasLegacySymbolDecoration({ symbol_mapping: { XAUUSD: 'GOLD' } }), true)
})

test('stripSymbolDecoration clears decoration fields', () => {
  const out = stripSymbolDecoration({
    fixed_lot: 0.1,
    symbol_prefix: '#',
    symbol_suffix: '+',
    symbol_mapping: { EURUSD: 'EURUSD.R' },
  })
  assert.equal(out.fixed_lot, 0.1)
  assert.equal(out.symbol_prefix, '')
  assert.equal(out.symbol_suffix, '')
  assert.deepEqual(out.symbol_mapping, {})
})

test('clearLegacySymbolDecorationIfPresent: updates db and in-memory broker', async () => {
  const updates: Record<string, unknown>[] = []
  const broker = {
    id: 'broker-1',
    manual_settings: { symbol_suffix: 'm', fixed_lot: 0.05 },
  } as unknown as BrokerRow
  const supabase = {
    from(table: string) {
      assert.equal(table, 'broker_accounts')
      return {
        update(patch: Record<string, unknown>) {
          updates.push(patch)
          return {
            eq(_col: string, id: string) {
              assert.equal(id, 'broker-1')
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
  const cleared = await clearLegacySymbolDecorationIfPresent(supabase as never, broker)
  assert.equal(cleared, true)
  assert.equal(updates.length, 1)
  const settings = updates[0]!.manual_settings as Record<string, unknown>
  assert.equal(settings.fixed_lot, 0.05)
  assert.equal(settings.symbol_suffix, '')
  assert.equal((broker.manual_settings as Record<string, unknown>).symbol_suffix, '')
})

test('clearLegacySymbolDecorationIfPresent: no-op when already clean', async () => {
  let called = false
  const broker = {
    id: 'broker-2',
    manual_settings: { fixed_lot: 0.1 },
  } as unknown as BrokerRow
  const supabase = {
    from() {
      called = true
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    },
  }
  const cleared = await clearLegacySymbolDecorationIfPresent(supabase as never, broker)
  assert.equal(cleared, false)
  assert.equal(called, false)
})
