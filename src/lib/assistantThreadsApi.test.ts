import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergeThreadStates,
  normalizeThreadRows,
} from './assistantThreadsApi'
import { createAssistantThreadId, MAX_THREADS, type AssistantThread } from './assistantClient'
import type { AssistantThreadRow } from '../types/database'

function makeThread(overrides: Partial<AssistantThread> = {}): AssistantThread {
  return {
    id: createAssistantThreadId(),
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    ...overrides,
  }
}

function makeRow(overrides: Partial<AssistantThreadRow> = {}): AssistantThreadRow {
  const now = new Date().toISOString()
  return {
    id: createAssistantThreadId(),
    user_id: 'u1',
    title: '',
    messages: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe('normalizeThreadRows', () => {
  it('maps DB rows into app threads sorted newest first', () => {
    const rows = [
      makeRow({ title: 'older', updated_at: '2026-01-01T00:00:00.000Z' }),
      makeRow({ title: 'newer', updated_at: '2026-01-02T00:00:00.000Z' }),
    ]
    const threads = normalizeThreadRows(rows)
    assert.equal(threads.length, 2)
    assert.equal(threads[0].title, 'newer')
    assert.ok(threads[0].updatedAt > threads[1].updatedAt)
  })

  it('validates message shape and drops malformed messages', () => {
    const row = makeRow({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'system', content: 'nope' },
        { content: 'no role' },
        null,
        { role: 'user', content: 42 },
      ] as unknown as AssistantThreadRow['messages'],
    })
    const [thread] = normalizeThreadRows([row])
    assert.equal(thread.messages.length, 2)
    assert.equal(thread.messages[0].content, 'hello')
  })

  it('caps at MAX_THREADS', () => {
    const rows = Array.from({ length: MAX_THREADS + 3 }, (_, i) =>
      makeRow({ updated_at: new Date(2026, 0, 1, 0, 0, i).toISOString() }),
    )
    assert.equal(normalizeThreadRows(rows).length, MAX_THREADS)
  })

  it('survives missing timestamps', () => {
    const rows = [makeRow({ created_at: '', updated_at: '' })]
    const [thread] = normalizeThreadRows(rows)
    assert.equal(typeof thread.createdAt, 'number')
    assert.equal(typeof thread.updatedAt, 'number')
    assert.ok(Number.isFinite(thread.createdAt))
  })
})

describe('mergeThreadStates', () => {
  it('unions db + local by id keeping the newer version', () => {
    const shared = makeThread({ id: 's1', title: 'db version', updatedAt: 200 })
    const db = [shared, makeThread({ id: 'd1', title: 'db only', updatedAt: 100 })]
    const local = [
      makeThread({ id: 's1', title: 'local version', updatedAt: 300 }),
      makeThread({ id: 'l1', title: 'local only', updatedAt: 50 }),
    ]
    const { threads } = mergeThreadStates(db, local, null)
    const merged = threads.find(t => t.id === 's1')
    assert.equal(merged?.title, 'local version')
    assert.ok(threads.some(t => t.id === 'd1'))
    assert.ok(threads.some(t => t.id === 'l1'))
  })

  it('prefers the preferred active id when present', () => {
    const a = makeThread({ id: 'a', updatedAt: 2 })
    const b = makeThread({ id: 'b', updatedAt: 1 })
    const { activeThreadId } = mergeThreadStates([a, b], [], 'b')
    assert.equal(activeThreadId, 'b')
  })

  it('falls back to the newest thread when preferred active is gone', () => {
    const a = makeThread({ id: 'a', updatedAt: 2 })
    const b = makeThread({ id: 'b', updatedAt: 1 })
    const { activeThreadId } = mergeThreadStates([a, b], [], 'missing')
    assert.equal(activeThreadId, 'a')
  })

  it('returns empty state when both sources are empty', () => {
    const { threads, activeThreadId } = mergeThreadStates([], [], null)
    assert.equal(threads.length, 0)
    assert.equal(activeThreadId, null)
  })

  it('caps merged threads at MAX_THREADS', () => {
    const db = Array.from({ length: MAX_THREADS }, (_, i) =>
      makeThread({ id: `d${i}`, updatedAt: i }),
    )
    const local = Array.from({ length: 4 }, (_, i) =>
      makeThread({ id: `l${i}`, updatedAt: 100 + i }),
    )
    const { threads } = mergeThreadStates(db, local, null)
    assert.equal(threads.length, MAX_THREADS)
    assert.equal(threads[0].id, 'l3')
  })
})
