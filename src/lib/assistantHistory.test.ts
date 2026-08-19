import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  assistantThreadTitle,
  compactThreadForApi,
  createAssistantThreadId,
  loadAssistantThreads,
  loadDeletedThreadIds,
  saveAssistantHistory,
  saveAssistantThreads,
  saveDeletedThreadIds,
  type AssistantThread,
} from './assistantClient'

function makeStorage() {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
  return { storage, map }
}

let storage: { storage: Storage; map: Map<string, string> }

beforeEach(() => {
  storage = makeStorage()
  // @ts-expect-error node has no sessionStorage
  globalThis.sessionStorage = storage.storage
})

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

describe('assistant thread history', () => {
  it('saves and reloads threads, keeping the active id', () => {
    const a = makeThread({ title: 'alpha', messages: [{ role: 'user', content: 'Alpha?' }] })
    const b = makeThread({ title: 'beta', messages: [{ role: 'user', content: 'Beta?' }] })
    saveAssistantThreads('u1', { threads: [a, b], activeThreadId: b.id })

    const state = loadAssistantThreads('u1')
    assert.equal(state.threads.length, 2)
    assert.equal(state.activeThreadId, b.id)
    assert.equal(state.threads.find(t => t.id === b.id)?.messages[0]?.content, 'Beta?')
  })

  it('sorts threads by updatedAt desc and caps at 8', () => {
    const threads = Array.from({ length: 10 }, (_, i) =>
      makeThread({ id: `t${i}`, title: `t${i}`, updatedAt: Date.now() + i }),
    )
    saveAssistantThreads('u1', { threads, activeThreadId: null })
    const state = loadAssistantThreads('u1')
    assert.equal(state.threads.length, 8)
    assert.equal(state.threads[0].id, 't9')
  })

  it('falls back to the most recent thread when active id is stale', () => {
    const a = makeThread({ id: 'a', title: 'a', updatedAt: 1 })
    const b = makeThread({ id: 'b', title: 'b', updatedAt: 2 })
    saveAssistantThreads('u1', { threads: [a, b], activeThreadId: 'missing' })
    const state = loadAssistantThreads('u1')
    assert.equal(state.activeThreadId, 'b')
  })

  it('derives thread titles from the first user message', () => {
    assert.equal(
      assistantThreadTitle([
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: '  Connect my MT5 account?  ' },
      ]),
      'Connect my MT5 account?',
    )
    assert.equal(assistantThreadTitle([{ role: 'assistant', content: 'hi' }]), '')
  })

  it('returns empty state when nothing is stored', () => {
    const state = loadAssistantThreads('nobody')
    assert.equal(state.threads.length, 0)
    assert.equal(state.activeThreadId, null)
  })

  it('migrates legacy single history into a thread', () => {
    saveAssistantHistory('u-legacy', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])
    const state = loadAssistantThreads('u-legacy')
    assert.equal(state.threads.length, 1)
    assert.equal(state.threads[0].messages.length, 2)
    assert.equal(state.threads[0].title, 'hello')
    assert.equal(state.activeThreadId, state.threads[0].id)
    assert.equal(storage.storage.getItem('tscopier.assistant.history.u-legacy'), null)
  })

  it('keeps legacy history when the threads write fails', () => {
    saveAssistantHistory('u-fail', [{ role: 'user', content: 'hello' }])
    const orig = storage.storage.setItem
    storage.storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const state = loadAssistantThreads('u-fail')
    storage.storage.setItem = orig
    assert.equal(state.threads.length, 1)
    assert.equal(state.activeThreadId, state.threads[0].id)
    assert.ok(storage.storage.getItem('tscopier.assistant.history.u-fail') !== null)
  })

  it('drops oldest threads when storage is full', () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      makeThread({ id: `t${i}`, title: `t${i}`, updatedAt: Date.now() + i }),
    )
    saveAssistantThreads('u-full', { threads, activeThreadId: 't7' })
    const state = loadAssistantThreads('u-full')
    assert.equal(state.threads.length, 8)
    assert.equal(state.activeThreadId, 't7')
  })

  it('fallback drops all threads and reports failure on persistent quota errors', () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      makeThread({ id: `t${i}`, title: `t${i}`, updatedAt: Date.now() + i }),
    )
    const orig = storage.storage.setItem
    storage.storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const ok = saveAssistantThreads('u-quota', { threads, activeThreadId: 't7' })
    storage.storage.setItem = orig
    assert.equal(ok, false)
  })
})

describe('compactThreadForApi', () => {
  it('caps messages at 20 and derives the title from the first user message', () => {
    const messages = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    const compacted = compactThreadForApi(makeThread({ title: '', messages }))
    assert.equal(compacted.messages.length, 20)
    assert.equal(compacted.messages[0].content, 'm5')
    assert.equal(compacted.title, 'm6')
  })

  it('keeps images only on the newest user turn', () => {
    const thread = makeThread({
      messages: [
        { role: 'user', content: 'first', images: ['data:image/png;base64,AAA'] },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second', images: ['data:image/png;base64,BBB'] },
      ],
    })
    const compacted = compactThreadForApi(thread)
    const withImages = compacted.messages.filter(m => m.images?.length)
    assert.equal(withImages.length, 1)
    assert.equal(withImages[0].content, 'second')
  })

  it('drops images when allowImages is false', () => {
    const thread = makeThread({
      messages: [{ role: 'user', content: 'hi', images: ['data:image/png;base64,AAA'] }],
    })
    const compacted = compactThreadForApi(thread, false)
    assert.equal(compacted.messages[0].images, undefined)
  })

  it('preserves tool results on assistant turns', () => {
    const thread = makeThread({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'done', tool_results: [{ tool: 'get_trades', result: '[]' }] },
      ],
    })
    const compacted = compactThreadForApi(thread)
    assert.equal(compacted.messages[1].tool_results?.[0].tool, 'get_trades')
  })
})

describe('deleted thread tombstones', () => {
  it('round-trips a set of deleted ids', () => {
    const ids = new Set(['a', 'b', 'c'])
    saveDeletedThreadIds('u-del', ids)
    const loaded = loadDeletedThreadIds('u-del')
    assert.deepEqual([...loaded].sort(), ['a', 'b', 'c'])
  })

  it('drops non-string entries on load', () => {
    storage.storage.setItem('tscopier.assistant.deleted.u-del', JSON.stringify(['a', 42, null, 'b']))
    const loaded = loadDeletedThreadIds('u-del')
    assert.deepEqual([...loaded].sort(), ['a', 'b'])
  })

  it('returns an empty set when nothing is stored', () => {
    assert.deepEqual([...loadDeletedThreadIds('u-none')], [])
  })

  it('returns an empty set on corrupt data', () => {
    storage.storage.setItem('tscopier.assistant.deleted.u-del', 'not-json')
    assert.deepEqual([...loadDeletedThreadIds('u-del')], [])
  })
})