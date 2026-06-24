import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTradeWorkerShardUrls,
  pickTradeWorkerUrl,
  validateListenerMgmtShardConfig,
  validateListenerTradeShardConfig,
} from './tradeSignalPush'

describe('parseTradeWorkerShardUrls', () => {
  it('trims and strips trailing slashes', () => {
    const urls = parseTradeWorkerShardUrls(' https://a.example.com/ , https://b.example.com ')
    assert.deepEqual(urls, ['https://a.example.com', 'https://b.example.com'])
  })
})

describe('validateListenerTradeShardConfig', () => {
  const prevUrls = process.env.TRADE_WORKER_SHARD_URLS
  const prevCount = process.env.TRADE_WORKER_SHARD_COUNT

  afterEach(() => {
    if (prevUrls === undefined) delete process.env.TRADE_WORKER_SHARD_URLS
    else process.env.TRADE_WORKER_SHARD_URLS = prevUrls
    if (prevCount === undefined) delete process.env.TRADE_WORKER_SHARD_COUNT
    else process.env.TRADE_WORKER_SHARD_COUNT = prevCount
  })

  it('returns null when shard URLs unset', () => {
    delete process.env.TRADE_WORKER_SHARD_URLS
    assert.equal(validateListenerTradeShardConfig(), null)
  })

  it('returns null when URL count matches TRADE_WORKER_SHARD_COUNT', () => {
    process.env.TRADE_WORKER_SHARD_URLS = 'https://a.example.com,https://b.example.com'
    process.env.TRADE_WORKER_SHARD_COUNT = '2'
    assert.equal(validateListenerTradeShardConfig(), null)
  })

  it('returns error when URL count mismatches TRADE_WORKER_SHARD_COUNT', () => {
    process.env.TRADE_WORKER_SHARD_URLS = 'https://a.example.com,https://b.example.com'
    process.env.TRADE_WORKER_SHARD_COUNT = '3'
    const err = validateListenerTradeShardConfig()
    assert.ok(err?.includes('2 URL'))
    assert.ok(err?.includes('TRADE_WORKER_SHARD_COUNT=3'))
  })
})

describe('pickTradeWorkerUrl management sharding', () => {
  const keys = [
    'TRADE_WORKER_URL',
    'TRADE_MGMT_WORKER_URL',
    'TRADE_WORKER_SHARD_URLS',
    'TRADE_MGMT_WORKER_SHARD_URLS',
  ] as const
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  })

  it('routes management actions onto a hashed mgmt shard', () => {
    process.env.TRADE_MGMT_WORKER_SHARD_URLS = 'https://m0.example.com,https://m1.example.com'
    const u1 = pickTradeWorkerUrl('modify', 'user-a')
    const u2 = pickTradeWorkerUrl('modify', 'user-a')
    assert.ok(u1 === 'https://m0.example.com' || u1 === 'https://m1.example.com')
    assert.equal(u1, u2, 'same user must hash to the same mgmt shard')
  })

  it('does not use mgmt shard URLs for entry actions', () => {
    process.env.TRADE_WORKER_URL = 'https://entry.example.com'
    process.env.TRADE_MGMT_WORKER_SHARD_URLS = 'https://m0.example.com,https://m1.example.com'
    assert.equal(pickTradeWorkerUrl('buy', 'user-a'), 'https://entry.example.com')
  })

  it('falls back to single mgmt URL when no mgmt shards set', () => {
    process.env.TRADE_WORKER_URL = 'https://entry.example.com'
    process.env.TRADE_MGMT_WORKER_URL = 'https://mgmt.example.com'
    assert.equal(pickTradeWorkerUrl('close', 'user-a'), 'https://mgmt.example.com')
  })
})

describe('validateListenerMgmtShardConfig', () => {
  const prevUrls = process.env.TRADE_MGMT_WORKER_SHARD_URLS
  const prevCount = process.env.TRADE_WORKER_SHARD_COUNT

  afterEach(() => {
    if (prevUrls === undefined) delete process.env.TRADE_MGMT_WORKER_SHARD_URLS
    else process.env.TRADE_MGMT_WORKER_SHARD_URLS = prevUrls
    if (prevCount === undefined) delete process.env.TRADE_WORKER_SHARD_COUNT
    else process.env.TRADE_WORKER_SHARD_COUNT = prevCount
  })

  it('returns null when mgmt shard URLs unset', () => {
    delete process.env.TRADE_MGMT_WORKER_SHARD_URLS
    assert.equal(validateListenerMgmtShardConfig(), null)
  })

  it('returns error when mgmt URL count mismatches shard count', () => {
    process.env.TRADE_MGMT_WORKER_SHARD_URLS = 'https://m0.example.com,https://m1.example.com'
    process.env.TRADE_WORKER_SHARD_COUNT = '3'
    const err = validateListenerMgmtShardConfig()
    assert.ok(err?.includes('2 URL'))
    assert.ok(err?.includes('TRADE_WORKER_SHARD_COUNT=3'))
  })
})
