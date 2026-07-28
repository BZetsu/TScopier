import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureSignalRow, isSignalFkViolation } from './ensureSignalRow'

test('isSignalFkViolation detects trades_signal_id_fkey', () => {
  assert.equal(
    isSignalFkViolation(
      'insert or update on table "trades" violates foreign key constraint "trades_signal_id_fkey"',
    ),
    true,
  )
})

test('isSignalFkViolation rejects unrelated errors', () => {
  assert.equal(isSignalFkViolation('duplicate key value'), false)
  assert.equal(isSignalFkViolation(null), false)
})

test('ensureSignalRow upserts by id via supabase client', async () => {
  const calls: Array<{ table: string; payload: unknown; opts: unknown }> = []
  const supabase = {
    from(table: string) {
      return {
        upsert(payload: unknown, opts: unknown) {
          calls.push({ table, payload, opts })
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  const result = await ensureSignalRow(supabase as never, {
    id: '68b4b9a4-1111-2222-3333-444444444444',
    user_id: 'user-1',
    channel_id: 'ch-1',
    raw_message: 'Gold buy now',
    status: 'parsed',
    parsed_data: { action: 'buy', symbol: 'XAUUSD' },
    telegram_message_id: '359',
  })

  assert.equal(result.ok, true)
  assert.equal(result.written, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.table, 'signals')
  assert.deepEqual(calls[0]?.opts, { onConflict: 'id' })
  const payload = calls[0]?.payload as Record<string, unknown>
  assert.equal(payload.id, '68b4b9a4-1111-2222-3333-444444444444')
  assert.equal(payload.raw_message, 'Gold buy now')
  assert.equal(payload.telegram_message_id, '359')
})

test('ensureSignalRow falls back to stub without telegram_message_id on unique conflict', async () => {
  let attempt = 0
  const payloads: Record<string, unknown>[] = []
  const supabase = {
    from(_table: string) {
      return {
        upsert(payload: Record<string, unknown>, _opts: unknown) {
          attempt += 1
          payloads.push(payload)
          if (attempt === 1) {
            return Promise.resolve({
              error: { message: 'duplicate key value violates unique constraint "signals_user_channel_telegram_message_unique_idx"' },
            })
          }
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  const result = await ensureSignalRow(supabase as never, {
    id: '68b4b9a4-aaaa-bbbb-cccc-dddddddddddd',
    user_id: 'user-1',
    channel_id: 'ch-1',
    raw_message: 'Gold buy now',
    telegram_message_id: '359',
  })

  assert.equal(result.ok, true)
  assert.equal(payloads.length, 2)
  assert.equal(payloads[1]?.telegram_message_id, null)
  assert.equal(payloads[1]?.id, '68b4b9a4-aaaa-bbbb-cccc-dddddddddddd')
})
