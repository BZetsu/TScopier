import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { signalExecutionProven } from './signalExecutionProven'

function makeSupabase(counts: {
  trades?: number
  waits?: number
  logs?: number
  rangePending?: number
}) {
  return {
    from(table: string) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        in() { return chain },
        then(resolve: (v: unknown) => void) {
          let count = 0
          if (table === 'trades') count = counts.trades ?? 0
          else if (table === 'signal_range_entry_waits') count = counts.waits ?? 0
          else if (table === 'trade_execution_logs') count = counts.logs ?? 0
          else if (table === 'range_pending_legs') count = counts.rangePending ?? 0
          resolve({ count })
        },
      }
      return chain
    },
  }
}

test('signalExecutionProven ignores range_pending_legs alone', async () => {
  const supabase = makeSupabase({ rangePending: 3, trades: 0, waits: 0, logs: 0 })
  assert.equal(await signalExecutionProven(supabase as never, 'sig-1'), false)
})

test('signalExecutionProven accepts trades', async () => {
  const supabase = makeSupabase({ trades: 1 })
  assert.equal(await signalExecutionProven(supabase as never, 'sig-1'), true)
})

test('signalExecutionProven accepts waiting range entry waits', async () => {
  const supabase = makeSupabase({ waits: 1 })
  assert.equal(await signalExecutionProven(supabase as never, 'sig-1'), true)
})

test('signalExecutionProven accepts success execution logs', async () => {
  const supabase = makeSupabase({ logs: 1 })
  assert.equal(await signalExecutionProven(supabase as never, 'sig-1'), true)
})
