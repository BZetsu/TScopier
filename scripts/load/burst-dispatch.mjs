#!/usr/bin/env node
/**
 * Synthetic burst load against trade entry POST /internal/dispatch-signal.
 * Fails closed unless the target worker proves load-test + broker-simulator mode.
 */

import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSyntheticSignal,
  HARD_LIMITS,
  assertSafeSupabaseUrl,
  percentile,
  readLimitedJson,
  sanitizeError,
  validateBurstConfig,
  writeJsonReport,
} from './load-safety.mjs'
import { cleanupBurstRun } from './load-cleanup.mjs'

let stopRequested = false
let stopReason = ''

function requestStop(reason) {
  if (!stopRequested) {
    stopRequested = true
    stopReason = reason
    console.warn(`stop requested: ${reason}`)
  }
}

function resetStopForTests() {
  stopRequested = false
  stopReason = ''
}

function installStopHandlers() {
  const onSigint = () => requestStop('SIGINT')
  process.on('SIGINT', onSigint)
  return () => process.off('SIGINT', onSigint)
}

async function stopFileExists(path) {
  if (!path) return false
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonSafe(res) {
  return await readLimitedJson(res)
}

function assertNoRedirect(res, config, label) {
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') ?? ''
    if (location) {
      const redirected = new URL(location, config.targetUrl)
      if (redirected.hostname !== config.targetUrl.hostname) {
        throw new Error(`${label} unexpectedly redirects to ${redirected.hostname}`)
      }
    }
    throw new Error(`${label} returned redirect status ${res.status}`)
  }
}

async function preflight(config, token) {
  const healthUrl = new URL('/health', config.targetUrl)
  const res = await fetchWithTimeout(healthUrl, {
    method: 'GET',
    headers: { 'x-internal-token': token },
  }, config.requestTimeoutMs)
  assertNoRedirect(res, config, '/health')
  const body = await readJsonSafe(res)
  if (!res.ok) throw new Error(`/health returned HTTP ${res.status}`)
  if (body?.load_test_enabled !== true) {
    throw new Error('target worker did not report load_test_enabled=true')
  }
  if (body?.broker_mode !== 'simulator') {
    throw new Error(`target worker broker_mode is not simulator: ${String(body?.broker_mode ?? 'missing')}`)
  }
  if (body?.simulator_enforced !== true) {
    throw new Error('target worker did not report simulator_enforced=true')
  }
  if (body?.live_broker_execution_enabled !== false) {
    throw new Error('target worker did not report live_broker_execution_enabled=false')
  }
  const environment = String(body?.environment ?? '')
  if (!['test', 'development', 'staging'].includes(environment)) {
    throw new Error(`target worker environment is not safe: ${environment || 'missing'}`)
  }
  return {
    environment,
    brokerMode: body.broker_mode,
    loadTestEnabled: true,
    simulatorEnforced: true,
    liveBrokerExecutionEnabled: false,
  }
}

function classifyResult(result) {
  if (result.kind === 'timeout') return 'timed_out'
  if (result.kind === 'network') return 'network_failed'
  if (result.status === 200 && result.body?.accepted === false && result.body?.reason === 'wrong_shard') return 'wrong_shard'
  if (result.status >= 200 && result.status < 300 && result.body?.accepted !== false) return 'accepted'
  return 'rejected'
}

async function postOne(config, token, userId, index) {
  const signal = buildSyntheticSignal({
    runId: config.runId,
    seed: config.seed,
    userId,
    index,
  })
  const body = JSON.stringify({
    signal,
    priority: 'high',
    source: 'load_test',
    synthetic: true,
    load_run_id: config.runId,
  })
  if (Buffer.byteLength(body, 'utf8') > HARD_LIMITS.payloadBytes) {
    throw new Error(`payload exceeds ${HARD_LIMITS.payloadBytes} bytes`)
  }

  const url = new URL('/internal/dispatch-signal', config.targetUrl)
  const t0 = performance.now()
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': token,
      },
      body,
    }, config.requestTimeoutMs)
    assertNoRedirect(res, config, '/internal/dispatch-signal')
    const ms = performance.now() - t0
    const json = await readJsonSafe(res)
    return { kind: 'http', status: res.status, ms, body: json }
  } catch (err) {
    const ms = performance.now() - t0
    if (err?.name === 'AbortError') return { kind: 'timeout', ms }
    return { kind: 'network', ms, error: sanitizeError(err) }
  }
}

function summarize(config, preflightResult, results, startedAt, completedAt, partial = false) {
  const latencies = results
    .map(r => r.ms)
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  const statusDistribution = {}
  const counts = {
    accepted: 0,
    rejected: 0,
    wrong_shard: 0,
    timed_out: 0,
    network_failed: 0,
  }
  for (const result of results) {
    const bucket = classifyResult(result)
    counts[bucket] += 1
    if (result.status) {
      const key = String(result.status)
      statusDistribution[key] = (statusDistribution[key] ?? 0) + 1
    }
  }
  const durationMs = completedAt - startedAt
  return {
    run_id: config.runId,
    seed: config.seed,
    partial,
    stop_reason: stopReason || null,
    target_host: config.targetUrl.hostname,
    target_environment: preflightResult.environment,
    broker_simulator_confirmed: preflightResult.brokerMode === 'simulator'
      && preflightResult.simulatorEnforced === true
      && preflightResult.liveBrokerExecutionEnabled === false,
    concurrency: config.concurrency,
    total_configured: config.total,
    total_attempted: results.length,
    ...counts,
    http_status_distribution: statusDistribution,
    duration_ms: Math.round(durationMs),
    throughput_rps: durationMs > 0 ? Number(((results.length / durationMs) * 1000).toFixed(2)) : 0,
    p50_ms: percentile(latencies, 50) == null ? null : Math.round(percentile(latencies, 50)),
    p95_ms: percentile(latencies, 95) == null ? null : Math.round(percentile(latencies, 95)),
    p99_ms: percentile(latencies, 99) == null ? null : Math.round(percentile(latencies, 99)),
    max_ms: latencies.length ? Math.round(latencies[latencies.length - 1]) : null,
  }
}

async function runBurst(config, token) {
  const preflightResult = await preflight(config, token)
  console.log(`load run ${config.runId} seed=${config.seed} host=${config.targetUrl.hostname} concurrency=${config.concurrency}`)
  const results = []
  let cursor = 0
  const startedAt = performance.now()
  const deadline = startedAt + config.maxRuntimeMs

  async function worker() {
    while (!stopRequested) {
      if (performance.now() >= deadline) {
        requestStop('runtime limit reached')
        break
      }
      if (await stopFileExists(config.stopFile)) {
        requestStop(`stop file ${config.stopFile}`)
        break
      }
      const index = cursor++
      if (index >= config.total) break
      const userId = config.userIds[index % config.userIds.length]
      let attempt = 0
      while (true) {
        const result = await postOne(config, token, userId, index)
        results.push(result)
        const bucket = classifyResult(result)
        if (bucket !== 'network_failed' && bucket !== 'timed_out') break
        if (attempt >= config.maxRetries || stopRequested) break
        attempt += 1
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()))
  return summarize(config, preflightResult, results, startedAt, performance.now(), stopRequested)
}

async function main() {
  const config = validateBurstConfig(process.env)
  const removeStopHandlers = installStopHandlers()
  const token = String(process.env.WORKER_INTERNAL_TOKEN ?? '').trim()
  const cleanupTarget = (() => {
    if (config.cleanupPolicy !== 'auto') return null
    const supabaseUrl = String(process.env.LOAD_SUPABASE_URL ?? '').trim()
    const serviceRoleKey = String(process.env.LOAD_SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('LOAD_CLEANUP_POLICY=auto requires LOAD_SUPABASE_URL and LOAD_SUPABASE_SERVICE_ROLE_KEY')
    }
    assertSafeSupabaseUrl(supabaseUrl, process.env, 'LOAD_SUPABASE_URL')
    return { supabaseUrl, serviceRoleKey }
  })()

  if (process.argv.includes('--cleanup-only') || process.env.LOAD_CLEANUP_ONLY === 'true') {
    const supabaseUrl = String(process.env.LOAD_SUPABASE_URL ?? '').trim()
    const serviceRoleKey = String(process.env.LOAD_SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Cleanup requires LOAD_SUPABASE_URL and LOAD_SUPABASE_SERVICE_ROLE_KEY')
    }
    assertSafeSupabaseUrl(supabaseUrl, process.env, 'LOAD_SUPABASE_URL')
    try {
      const cleanup = await cleanupBurstRun({
        supabaseUrl,
        serviceRoleKey,
        runId: config.runId,
        confirmDelete: process.argv.includes('--confirm-delete'),
      })
      console.log(JSON.stringify({ run_id: config.runId, cleanup }, null, 2))
      return
    } finally {
      removeStopHandlers()
    }
  }

  try {
    const summary = await runBurst(config, token)
    console.log(JSON.stringify(summary, null, 2))
    const reportFile = config.reportFile || `${config.reportDir}/burst-${config.runId}.json`
    await writeJsonReport(reportFile, summary, {
      allowOverwrite: process.env.LOAD_REPORT_OVERWRITE === 'true',
    })
    if (cleanupTarget) {
      const cleanup = await cleanupBurstRun({
        ...cleanupTarget,
        runId: config.runId,
        confirmDelete: process.argv.includes('--confirm-delete'),
      })
      console.log(JSON.stringify({ run_id: config.runId, cleanup }, null, 2))
    }
    if (summary.partial) process.exitCode = 130
  } finally {
    removeStopHandlers()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(err => {
    console.error(`Fatal: ${sanitizeError(err)}`)
    process.exit(1)
  })
}

export {
  classifyResult,
  preflight,
  requestStop,
  resetStopForTests,
  runBurst,
  summarize,
  installStopHandlers,
}
