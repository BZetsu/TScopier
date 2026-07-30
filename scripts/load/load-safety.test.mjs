import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildSyntheticSignal,
  LoadSafetyError,
  readLimitedJson,
  runMarker,
  sanitizeError,
  safeArtifactPath,
  syntheticUserId,
  validateBurstConfig,
  validateSection6Config,
} from './load-safety.mjs'
import { cleanupBurstRun } from './load-cleanup.mjs'
import {
  classifyResult,
  preflight,
  resetStopForTests,
  runBurst,
  requestStop,
} from './burst-dispatch.mjs'
import {
  buildPayloads,
  buildSyntheticUsers,
} from '../section6-scale-test.js'

function baseBurstEnv(overrides = {}) {
  const runId = overrides.LOAD_RUN_ID ?? 'loadtest-run-001'
  const marker = runMarker(runId)
  return {
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'test',
    LOAD_CLEANUP_POLICY: 'auto',
    LOAD_ALLOWED_HOSTS: 'staging-worker.example.test,localhost',
    TRADE_WORKER_URL: 'https://staging-worker.example.test',
    WORKER_INTERNAL_TOKEN: 'test-token',
    LOAD_USER_IDS: `loadtest_user_${marker}_0001,loadtest_user_${marker}_0002`,
    LOAD_RUN_ID: runId,
    ...overrides,
  }
}

function assertRejectsSafety(fn, pattern) {
  assert.throws(fn, err => err instanceof LoadSafetyError && pattern.test(err.message))
}

function cleanupEnv(overrides = {}) {
  return {
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'test',
    LOAD_CLEANUP_POLICY: 'manual',
    LOAD_CLEANUP_ONLY: 'true',
    LOAD_ALLOWED_SUPABASE_PROJECT_REFS: 'abcdefghijklmnopqrst',
    ...overrides,
  }
}

test('rejects production frontend URL', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({
      TRADE_WORKER_URL: 'https://app.tscopier.ai',
      LOAD_ALLOWED_HOSTS: 'app.tscopier.ai',
    })),
    /production target/,
  )
})

test('rejects sso.tscopier.ai', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({
      TRADE_WORKER_URL: 'https://sso.tscopier.ai',
      LOAD_ALLOWED_HOSTS: 'sso.tscopier.ai',
    })),
    /production target/,
  )
})

test('rejects trailing-dot production hostname even when allowlisted', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({
      TRADE_WORKER_URL: 'https://sso.tscopier.ai.:8443',
      LOAD_ALLOWED_HOSTS: 'sso.tscopier.ai.',
    })),
    /production target/,
  )
})

test('rejects mixed-case production hostname with port', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({
      TRADE_WORKER_URL: 'https://App.TSCOPIER.AI:443',
      LOAD_ALLOWED_HOSTS: 'app.tscopier.ai',
    })),
    /production target/,
  )
})

test('rejects embedded URL credentials', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({
      TRADE_WORKER_URL: 'https://token@staging-worker.example.test',
    })),
    /embedded credentials/,
  )
})

test('rejects unknown remote host', () => {
  assertRejectsSafety(
    () => validateBurstConfig(baseBurstEnv({ TRADE_WORKER_URL: 'https://unknown.example.test' })),
    /not in LOAD_ALLOWED_HOSTS/,
  )
})

test('accepts explicit allowlisted staging host', () => {
  const cfg = validateBurstConfig(baseBurstEnv())
  assert.equal(cfg.targetUrl.hostname, 'staging-worker.example.test')
})

test('rejects missing LOAD_TEST_MODE', () => {
  const env = baseBurstEnv()
  delete env.LOAD_TEST_MODE
  assertRejectsSafety(() => validateBurstConfig(env), /LOAD_TEST_MODE=true/)
})

test('preflight rejects missing target safety capability', async () => {
  const cfg = validateBurstConfig(baseBurstEnv())
  const prev = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  try {
    await assert.rejects(() => preflight(cfg, 'token'), /load_test_enabled=true/)
  } finally {
    globalThis.fetch = prev
  }
})

test('preflight rejects live broker mode', async () => {
  const cfg = validateBurstConfig(baseBurstEnv())
  const prev = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    load_test_enabled: true,
    broker_mode: 'live',
    simulator_enforced: false,
    live_broker_execution_enabled: true,
    environment: 'test',
  }), { status: 200 })
  try {
    await assert.rejects(() => preflight(cfg, 'token'), /broker_mode is not simulator/)
  } finally {
    globalThis.fetch = prev
  }
})

test('preflight rejects declared-only simulator mode', async () => {
  const cfg = validateBurstConfig(baseBurstEnv())
  const prev = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    load_test_enabled: true,
    broker_mode: 'simulator',
    environment: 'test',
  }), { status: 200 })
  try {
    await assert.rejects(() => preflight(cfg, 'token'), /simulator_enforced=true/)
  } finally {
    globalThis.fetch = prev
  }
})

test('preflight rejects redirect response', async () => {
  const cfg = validateBurstConfig(baseBurstEnv())
  const prev = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'https://app.tscopier.ai/health' } })
  try {
    await assert.rejects(() => preflight(cfg, 'token'), /redirect/)
  } finally {
    globalThis.fetch = prev
  }
})

test('limited JSON reader rejects oversized response bodies', async () => {
  const body = 'x'.repeat(1025)
  await assert.rejects(() => readLimitedJson(new Response(body), 1024), /exceeds/)
})

test('enforces concurrency ceiling', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({ LOAD_CONCURRENCY: '51' })), /ceiling/)
})

test('enforces signal-count ceiling', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({ LOAD_SIGNAL_COUNT: '2001' })), /ceiling/)
})

test('enforces runtime ceiling', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({ LOAD_MAX_RUNTIME_MS: '900001' })), /ceiling/)
})

test('rejects invalid numeric input', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({ LOAD_CONCURRENCY: 'NaN' })), /positive integer/)
})

test('rejects duplicate synthetic users', () => {
  const id = syntheticUserId('loadtest-run-001', 1)
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({ LOAD_USER_IDS: `${id}, ${id.toUpperCase()}` })), /duplicate/)
})

test('rejects UUID-shaped user id even if run text overlaps', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({
    LOAD_RUN_ID: '12345678-1234-1234-1234-123456789abc'.replace(/-/g, '_'),
    LOAD_USER_IDS: '12345678-1234-4234-9234-123456789abc',
  })), /UUID-shaped|synthetic/)
})

test('propagates stable run ID into generated signal', () => {
  const marker = runMarker('loadtest-run-001')
  const signal = buildSyntheticSignal({
    runId: 'loadtest-run-001',
    seed: 'seed-a',
    userId: syntheticUserId('loadtest-run-001', 1),
    index: 7,
  })
  assert.match(signal.id, new RegExp(`^loadtest_signal_${marker}_`))
  assert.equal(signal.parsed_data.load_run_id, 'loadtest-run-001')
  assert.equal(signal.pipeline_ts.load_run_id, 'loadtest-run-001')
})

test('seeded generation is reproducible', () => {
  const a = buildSyntheticSignal({ runId: 'run-0001', seed: 'same', userId: syntheticUserId('run-0001', 1), index: 1 })
  const b = buildSyntheticSignal({ runId: 'run-0001', seed: 'same', userId: syntheticUserId('run-0001', 1), index: 1 })
  assert.deepEqual(a, b)
})

test('different seeds produce different inputs', () => {
  const a = buildSyntheticSignal({ runId: 'run-0001', seed: 'a', userId: syntheticUserId('run-0001', 1), index: 1 })
  const b = buildSyntheticSignal({ runId: 'run-0001', seed: 'b', userId: syntheticUserId('run-0001', 1), index: 1 })
  assert.notDeepEqual(a.parsed_data, b.parsed_data)
})

test('SIGINT stop state prevents new scheduling after preflight', async () => {
  resetStopForTests()
  requestStop('SIGINT')
  const cfg = validateBurstConfig(baseBurstEnv({ LOAD_SIGNAL_COUNT: '10' }))
  const prev = globalThis.fetch
  let dispatchCalls = 0
  globalThis.fetch = async url => {
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({
        load_test_enabled: true,
        broker_mode: 'simulator',
        simulator_enforced: true,
        live_broker_execution_enabled: false,
        environment: 'test',
      }), { status: 200 })
    }
    dispatchCalls += 1
    return new Response(JSON.stringify({ accepted: true }), { status: 200 })
  }
  try {
    const summary = await runBurst(cfg, 'token')
    assert.equal(summary.total_attempted, 0)
    assert.equal(dispatchCalls, 0)
    assert.equal(summary.partial, true)
  } finally {
    globalThis.fetch = prev
    resetStopForTests()
  }
})

test('stop file stops new scheduling', async () => {
  resetStopForTests()
  const dir = await mkdtemp(join(tmpdir(), 'load-stop-'))
  const stopFile = join(dir, 'STOP')
  await writeFile(stopFile, '')
  const cfg = validateBurstConfig(baseBurstEnv({ LOAD_STOP_FILE: stopFile, LOAD_SIGNAL_COUNT: '10' }))
  const prev = globalThis.fetch
  let dispatchCalls = 0
  globalThis.fetch = async url => {
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({
        load_test_enabled: true,
        broker_mode: 'simulator',
        simulator_enforced: true,
        live_broker_execution_enabled: false,
        environment: 'test',
      }), { status: 200 })
    }
    dispatchCalls += 1
    return new Response(JSON.stringify({ accepted: true }), { status: 200 })
  }
  try {
    const summary = await runBurst(cfg, 'token')
    assert.equal(summary.total_attempted, 0)
    assert.equal(dispatchCalls, 0)
  } finally {
    globalThis.fetch = prev
    resetStopForTests()
    await rm(dir, { recursive: true, force: true })
  }
})

test('cleanup targets only matching run IDs', async () => {
  const calls = []
  const runId = 'cleanup-run-001'
  const marker = runMarker(runId)
  const prev = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? 'GET' })
    return new Response(`[{"id":"loadtest_signal_${marker}_000001","signal_id":"loadtest_signal_${marker}_000001"}]`, {
      status: 200,
      headers: { 'content-range': '0-0/1' },
    })
  }
  try {
    const result = await cleanupBurstRun({
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      serviceRoleKey: 'secret',
      runId,
      env: cleanupEnv(),
    })
    assert.ok(calls.some(c => c.url.includes(`loadtest_signal_${marker}_`)))
    assert.ok(calls.every(c => !c.url.includes('created_at=')))
    assert.ok(calls.every(c => c.method !== 'DELETE'))
    assert.ok(result.every(row => row.dry_run === true || row.error))
  } finally {
    globalThis.fetch = prev
  }
})

test('cleanup refuses missing untagged run ID', async () => {
  await assert.rejects(() => cleanupBurstRun({
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    serviceRoleKey: 'secret',
    runId: '',
    env: cleanupEnv(),
  }), /LOAD_RUN_ID/)
})

test('cleanup rejects shared-prefix unsafe run ids and keeps full marker isolation', () => {
  const a = runMarker('shared-prefix-run-aaaaaaaaaaaaaa')
  const b = runMarker('shared-prefix-run-bbbbbbbbbbbbbb')
  assert.notEqual(a, b)
})

test('cleanup requires explicit LOAD_TEST_MODE', async () => {
  await assert.rejects(() => cleanupBurstRun({
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    serviceRoleKey: 'secret',
    runId: 'cleanup-run-001',
    env: cleanupEnv({ LOAD_TEST_MODE: 'false' }),
  }), /LOAD_TEST_MODE=true/)
})

test('secret values are redacted from logged errors', () => {
  const msg = sanitizeError(new Error('bad Bearer eyJabc.def.ghi and eyJaaa.bbb.ccc'))
  assert.doesNotMatch(msg, /eyJabc/)
  assert.match(msg, /\[redacted-jwt\]/)
})

test('section6 rejects production Supabase URLs', () => {
  assertRejectsSafety(() => validateSection6Config({
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'staging',
    LOAD_CLEANUP_POLICY: 'auto',
    LOAD_ALLOWED_SUPABASE_PROJECT_REFS: 'sxkpcovbyaficvgtkpsdo',
    TARGET_SUPABASE_URL: 'https://sxkpcovbyaficvgtkpsdo.supabase.co',
    TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-secret',
  }), /production Supabase|direct Supabase/)
})

test('section6 does not require source Supabase variables', () => {
  const cfg = validateSection6Config({
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'staging',
    LOAD_CLEANUP_POLICY: 'manual',
    LOAD_ALLOWED_SUPABASE_PROJECT_REFS: 'abcdefghijklmnopqrst',
    TARGET_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-secret',
    LOAD_RUN_ID: 'section6-run-001',
  })
  assert.equal(cfg.userCount, 53)
  assert.equal(cfg.targetRef, 'abcdefghijklmnopqrst')
})

test('section6 generated shape is deterministic and contains no PII session fields', () => {
  const cfg = validateSection6Config({
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'staging',
    LOAD_CLEANUP_POLICY: 'manual',
    LOAD_ALLOWED_SUPABASE_PROJECT_REFS: 'abcdefghijklmnopqrst',
    TARGET_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-secret',
    LOAD_RUN_ID: 'section6-run-002',
    LOAD_SEED: 'shape-seed',
    LOAD_USER_COUNT: '3',
    LOAD_CHANNELS_PER_USER_MIN: '2',
    LOAD_CHANNELS_PER_USER_MAX: '2',
  })
  const usersA = buildSyntheticUsers(cfg)
  const usersB = buildSyntheticUsers(cfg)
  const payloadsA = buildPayloads(cfg, usersA)
  const payloadsB = buildPayloads(cfg, usersB)
  assert.deepEqual(usersA, usersB)
  assert.deepEqual(payloadsA, payloadsB)
  assert.equal(payloadsA.sessions.length, 3)
  assert.equal(payloadsA.channels.length, 6)
  assert.ok(payloadsA.sessions.every(row => row.session_string === '' && row.phone_number === ''))
  assert.ok(payloadsA.channels.every(row => row.channel_keywords.synthetic === true))
})

test('different section6 runs create distinct identities', () => {
  const base = {
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'staging',
    LOAD_CLEANUP_POLICY: 'manual',
    LOAD_ALLOWED_SUPABASE_PROJECT_REFS: 'abcdefghijklmnopqrst',
    TARGET_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-secret',
    LOAD_USER_COUNT: '1',
  }
  const a = buildSyntheticUsers(validateSection6Config({ ...base, LOAD_RUN_ID: 'section6-run-003' }))
  const b = buildSyntheticUsers(validateSection6Config({ ...base, LOAD_RUN_ID: 'section6-run-004' }))
  assert.notEqual(a[0].userId, b[0].userId)
  assert.notEqual(a[0].username, b[0].username)
})

test('report path traversal and absolute paths are rejected', async () => {
  await assert.rejects(() => safeArtifactPath('../escape.json', 'default.json'), /traversal|relative/)
  await assert.rejects(() => safeArtifactPath('C:\\tmp\\escape.json', 'default.json'), /relative/)
  await assert.rejects(() => safeArtifactPath('\\\\server\\share\\escape.json', 'default.json'), /relative/)
})

test('valid load-results filename is accepted and existing file is refused', async () => {
  const name = `test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  const path = await safeArtifactPath(`load-results/${name}`, 'default.json')
  try {
    assert.match(path, /load-results/)
    await assert.rejects(() => safeArtifactPath(`load-results/${name}`, 'default.json'), /already exists/)
  } finally {
    await unlink(path).catch(() => {})
  }
})

test('existing burst script cannot run with production URL even when token exists', () => {
  assertRejectsSafety(() => validateBurstConfig(baseBurstEnv({
    TRADE_WORKER_URL: 'https://tscopier.ai',
    LOAD_ALLOWED_HOSTS: 'tscopier.ai',
    WORKER_INTERNAL_TOKEN: 'prod-looking-token',
  })), /production target/)
})

test('classifies wrong shard and rejected responses', () => {
  assert.equal(classifyResult({ kind: 'http', status: 200, body: { accepted: false, reason: 'wrong_shard' } }), 'wrong_shard')
  assert.equal(classifyResult({ kind: 'http', status: 500, body: {} }), 'rejected')
})
