import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HARD_LIMITS = Object.freeze({
  concurrency: 50,
  signalCount: 2000,
  runtimeMs: 15 * 60 * 1000,
  requestTimeoutMs: 30_000,
  retries: 3,
  users: 100,
  payloadBytes: 16 * 1024,
  shutdownGraceMs: 30_000,
  responseBytes: 256 * 1024,
})

const SAFE_NODE_ENVS = new Set(['test', 'development', 'staging'])
const SAFE_CLEANUP_POLICIES = new Set(['auto', 'manual', 'keep'])
const PRODUCTION_HOSTS = new Set([
  'sso.tscopier.ai',
  'tscopier.ai',
  'www.tscopier.ai',
  'app.tscopier.ai',
  'dashboard.tscopier.ai',
  'api.tscopier.ai',
])
const PRODUCTION_SUPABASE_REFS = new Set([
  'sxkpcovbyaficvgtkpsdo',
])
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LOAD_RESULTS_ROOT = resolve(REPO_ROOT, 'load-results')
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,119}$/
const BAD_RUN_ID_RE = /[\s*%/\\.:]|\.\.|^_+$|^-+$/

export class LoadSafetyError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'LoadSafetyError'
    this.details = details
  }
}

export function envList(value) {
  return String(value ?? '')
    .split(',')
    .map(v => normalizeHostname(v.trim()))
    .filter(Boolean)
}

export function requireEnv(env, names) {
  const missing = names.filter(name => !String(env[name] ?? '').trim())
  if (missing.length) {
    throw new LoadSafetyError(`Missing required environment variables: ${missing.join(', ')}`, { missing })
  }
}

export function parsePositiveInt(env, key, defaults, ceilingKey) {
  const raw = String(env[key] ?? defaults[key])
  if (raw.length > 12 || !/^[0-9]+$/.test(raw)) {
    throw new LoadSafetyError(`${key} must be a positive integer`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new LoadSafetyError(`${key} must be a positive integer`)
  }
  const ceiling = HARD_LIMITS[ceilingKey]
  if (n > ceiling) {
    throw new LoadSafetyError(`${key}=${n} exceeds hard ceiling ${ceiling}`)
  }
  return n
}

export function parseRuntimeMs(env, key = 'LOAD_MAX_RUNTIME_MS') {
  const raw = String(env[key] ?? HARD_LIMITS.runtimeMs)
  if (raw.length > 12 || !/^[0-9]+$/.test(raw)) {
    throw new LoadSafetyError(`${key} must be a positive integer`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new LoadSafetyError(`${key} must be a positive integer`)
  }
  if (n > HARD_LIMITS.runtimeMs) {
    throw new LoadSafetyError(`${key}=${n} exceeds hard ceiling ${HARD_LIMITS.runtimeMs}`)
  }
  return n
}

export function parseUrl(value, label) {
  try {
    const url = new URL(String(value ?? '').trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    if (url.username || url.password) {
      throw new LoadSafetyError(`${label} must not contain embedded credentials`)
    }
    normalizeHostname(url.hostname)
    return url
  } catch (err) {
    if (err instanceof LoadSafetyError) throw err
    throw new LoadSafetyError(`${label} must be a valid unambiguous http(s) URL`)
  }
}

export function normalizeHostname(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\.+$/, '')
  if (!raw) return ''
  if (raw.includes('%') || raw.includes('/') || raw.includes('\\') || raw.includes('@')) {
    throw new LoadSafetyError(`Ambiguous hostname is not permitted: ${raw.slice(0, 80)}`)
  }
  if (raw.length > 253) throw new LoadSafetyError('Hostname is too long')
  if (raw === '::1') return raw
  if (raw.includes(':') && !/^[0-9a-f:]+$/i.test(raw)) {
    throw new LoadSafetyError(`Ambiguous hostname is not permitted: ${raw.slice(0, 80)}`)
  }
  return raw
}

function normalizedUrlHost(url) {
  return normalizeHostname(url.hostname)
}

function isProductionHost(host) {
  return PRODUCTION_HOSTS.has(host) || host === 'tscopier.ai' || host.endsWith('.tscopier.ai')
}

function assertSafePort(url, label) {
  if (!url.port) return
  const n = Number(url.port)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new LoadSafetyError(`${label} port is invalid`)
  }
}

export function validateStopFilePath(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  if (value.includes('\0')) throw new LoadSafetyError('LOAD_STOP_FILE contains an invalid path')
  return resolve(value)
}

export function validateRunId(raw, label = 'LOAD_RUN_ID') {
  const supplied = String(raw ?? '').trim()
  if (!RUN_ID_RE.test(supplied) || BAD_RUN_ID_RE.test(supplied)) {
    throw new LoadSafetyError(`${label} must be 8-120 letters, digits, underscore, or hyphen`)
  }
  if (/eyJ[A-Za-z0-9_-]+\./.test(supplied)) {
    throw new LoadSafetyError(`${label} must not contain token-looking values`)
  }
  return supplied
}

export function runMarker(runId) {
  const valid = validateRunId(runId)
  return createHash('sha256').update(valid).digest('hex').slice(0, 32)
}

export function syntheticUserId(runId, index) {
  return `loadtest_user_${runMarker(runId)}_${String(index).padStart(4, '0')}`
}

export function validateSyntheticUserId(id, runId) {
  const value = String(id ?? '').trim().toLowerCase()
  const marker = runMarker(runId)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new LoadSafetyError('LOAD_USER_IDS must not contain UUID-shaped real user ids')
  }
  if (!new RegExp(`^loadtest_user_${marker}_[a-z0-9_-]{4,32}$`).test(value)) {
    throw new LoadSafetyError('LOAD_USER_IDS must use loadtest_user_<run_hash>_<suffix> synthetic ids')
  }
  if (value.length > 80) throw new LoadSafetyError('LOAD_USER_IDS contains an id exceeding the safe length')
  return value
}

export async function safeArtifactPath(input, defaultFilename, opts = {}) {
  const raw = String(input || defaultFilename || '').trim()
  if (!raw) throw new LoadSafetyError('Report filename is required')
  if (raw.includes('\0')) throw new LoadSafetyError('Report filename is invalid')
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//')) {
    throw new LoadSafetyError('Report path must be relative under load-results')
  }
  const normalized = raw.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.includes('..') || parts.includes('.')) {
    throw new LoadSafetyError('Report path must not contain traversal segments')
  }
  const filename = parts[0] === 'load-results'
    ? parts.slice(1).join('/')
    : parts.join('/')
  if (!filename || filename !== basename(filename)) {
    throw new LoadSafetyError('Report path must be a filename under load-results')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.json$/.test(filename)) {
    throw new LoadSafetyError('Report filename must be a safe .json filename')
  }
  await mkdir(LOAD_RESULTS_ROOT, { recursive: true })
  const root = await realpath(LOAD_RESULTS_ROOT)
  const target = resolve(root, filename)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new LoadSafetyError('Report path escapes load-results')
  }
  if (opts.allowOverwrite !== true) {
    try {
      const fh = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await fh.close()
      return target
    } catch (err) {
      if (err?.code === 'EEXIST') throw new LoadSafetyError(`Report already exists: ${filename}`)
      throw err
    }
  }
  return target
}

export async function readLimitedText(res, limitBytes = HARD_LIMITS.responseBytes) {
  const len = res.headers?.get?.('content-length')
  if (len != null && len !== '') {
    const n = Number(len)
    if (!Number.isFinite(n) || n > limitBytes) throw new LoadSafetyError(`Response body exceeds ${limitBytes} bytes`)
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text().catch(() => '')
    if (Buffer.byteLength(text, 'utf8') > limitBytes) throw new LoadSafetyError(`Response body exceeds ${limitBytes} bytes`)
    return text
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limitBytes) {
      await reader.cancel().catch(() => {})
      throw new LoadSafetyError(`Response body exceeds ${limitBytes} bytes`)
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}

export async function readLimitedJson(res, limitBytes = HARD_LIMITS.responseBytes) {
  const text = await readLimitedText(res, limitBytes)
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function supabaseProjectRef(value) {
  const url = parseUrl(value, 'Supabase URL')
  const host = normalizedUrlHost(url)
  if (host === 'sso.tscopier.ai') return 'sxkpcovbyaficvgtkpsdo'
  const match = host.match(/^([a-z0-9]{20})\.supabase\.co$/)
  return match?.[1] ?? null
}

export function assertSafeTargetUrl(value, env, label = 'target URL') {
  const url = parseUrl(value, label)
  const host = normalizedUrlHost(url)
  const allowedHosts = new Set(envList(env.LOAD_ALLOWED_HOSTS))
  assertSafePort(url, label)

  if (isProductionHost(host)) {
    throw new LoadSafetyError(`${label} host is a known production target: ${host}`)
  }
  if (host.endsWith('.supabase.co')) {
    const ref = supabaseProjectRef(url.href)
    if (ref && PRODUCTION_SUPABASE_REFS.has(ref)) {
      throw new LoadSafetyError(`${label} uses a known production Supabase project`)
    }
  }
  if (!allowedHosts.has(host)) {
    throw new LoadSafetyError(`${label} host is not in LOAD_ALLOWED_HOSTS: ${host}`)
  }
  return url
}

export function assertSafeSupabaseUrl(value, env, label = 'Supabase URL') {
  const url = parseUrl(value, label)
  assertSafePort(url, label)
  const ref = supabaseProjectRef(url.href)
  const allowedRefs = new Set(envList(env.LOAD_ALLOWED_SUPABASE_PROJECT_REFS))

  if (!ref) {
    throw new LoadSafetyError(`${label} must be a direct Supabase project URL for load-test cleanup/setup`)
  }
  if (PRODUCTION_SUPABASE_REFS.has(ref)) {
    throw new LoadSafetyError(`${label} uses a known production Supabase project ref`)
  }
  if (!allowedRefs.has(ref)) {
    throw new LoadSafetyError(`${label} project ref is not in LOAD_ALLOWED_SUPABASE_PROJECT_REFS`)
  }
  return { url, ref }
}

export function createRunId(env) {
  const supplied = String(env.LOAD_RUN_ID ?? '').trim()
  if (!supplied) return randomUUID()
  return validateRunId(supplied)
}

export function assertCommonSafety(env, opts = {}) {
  if (String(env.LOAD_TEST_MODE ?? '').toLowerCase() !== 'true') {
    throw new LoadSafetyError('LOAD_TEST_MODE=true is required')
  }
  const nodeEnv = String(env.NODE_ENV ?? '').toLowerCase()
  if (!SAFE_NODE_ENVS.has(nodeEnv)) {
    throw new LoadSafetyError('NODE_ENV must be test, development, or staging')
  }
  const cleanupPolicy = String(env.LOAD_CLEANUP_POLICY ?? (process.argv.includes('--keep-data') ? 'keep' : '')).toLowerCase()
  if (!SAFE_CLEANUP_POLICIES.has(cleanupPolicy)) {
    throw new LoadSafetyError('LOAD_CLEANUP_POLICY must be auto, manual, or keep')
  }
  if (String(env.LOAD_ALLOW_LIVE_BROKERS ?? '').toLowerCase() === 'true') {
    throw new LoadSafetyError('Live broker execution is never permitted by the load harness')
  }
  if (String(env.LOAD_ALLOW_PRODUCTION_TELEGRAM_SESSIONS ?? '').toLowerCase() === 'true') {
    throw new LoadSafetyError('Production Telegram sessions are never permitted by the load harness')
  }
  const runId = createRunId(env)
  return {
    runId,
    environment: nodeEnv,
    cleanupPolicy,
    maxRuntimeMs: parseRuntimeMs(env),
    requestTimeoutMs: parsePositiveInt(env, 'LOAD_REQUEST_TIMEOUT_MS', { LOAD_REQUEST_TIMEOUT_MS: 10_000 }, 'requestTimeoutMs'),
    maxRetries: parseNonNegativeInt(env, 'LOAD_MAX_RETRIES', 0, HARD_LIMITS.retries),
    reportDir: 'load-results',
    keepData: opts.allowKeepData === true && cleanupPolicy === 'keep',
  }
}

export function parseNonNegativeInt(env, key, defaultValue, ceiling) {
  const raw = String(env[key] ?? defaultValue)
  if (raw.length > 12 || !/^[0-9]+$/.test(raw)) {
    throw new LoadSafetyError(`${key} must be a non-negative integer`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new LoadSafetyError(`${key} must be a non-negative integer`)
  }
  if (n > ceiling) {
    throw new LoadSafetyError(`${key}=${n} exceeds hard ceiling ${ceiling}`)
  }
  return n
}

export function validateBurstConfig(env) {
  requireEnv(env, ['TRADE_WORKER_URL', 'WORKER_INTERNAL_TOKEN', 'LOAD_USER_IDS'])
  const common = assertCommonSafety(env, { allowKeepData: true })
  const targetUrl = assertSafeTargetUrl(env.TRADE_WORKER_URL, env, 'TRADE_WORKER_URL')
  const userIds = String(env.LOAD_USER_IDS)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (!userIds.length) throw new LoadSafetyError('LOAD_USER_IDS must contain at least one synthetic user id')
  if (userIds.length > HARD_LIMITS.users) {
    throw new LoadSafetyError(`LOAD_USER_IDS contains ${userIds.length} users, hard ceiling is ${HARD_LIMITS.users}`)
  }
  const normalizedUsers = []
  const seen = new Set()
  for (const id of userIds) {
    const normalized = validateSyntheticUserId(id, common.runId)
    if (seen.has(normalized)) {
      throw new LoadSafetyError(`LOAD_USER_IDS contains duplicate synthetic id: ${normalized}`)
    }
    seen.add(normalized)
    normalizedUsers.push(normalized)
  }
  return {
    ...common,
    targetUrl,
    userIds: normalizedUsers,
    total: parsePositiveInt(env, 'LOAD_SIGNAL_COUNT', { LOAD_SIGNAL_COUNT: 100 }, 'signalCount'),
    concurrency: parsePositiveInt(env, 'LOAD_CONCURRENCY', { LOAD_CONCURRENCY: 5 }, 'concurrency'),
    seed: String(env.LOAD_SEED ?? common.runId),
    stopFile: validateStopFilePath(env.LOAD_STOP_FILE),
    reportFile: String(env.LOAD_REPORT_FILE ?? '').trim(),
  }
}

export function validateSection6Config(env) {
  requireEnv(env, [
    'TARGET_SUPABASE_URL',
    'TARGET_SUPABASE_SERVICE_ROLE_KEY',
  ])
  const common = assertCommonSafety(env, { allowKeepData: true })
  const target = assertSafeSupabaseUrl(env.TARGET_SUPABASE_URL, env, 'TARGET_SUPABASE_URL')
  const userCount = parsePositiveInt(env, 'LOAD_USER_COUNT', { LOAD_USER_COUNT: 53 }, 'users')
  const minChannels = parsePositiveInt(env, 'LOAD_CHANNELS_PER_USER_MIN', { LOAD_CHANNELS_PER_USER_MIN: 2 }, 'users')
  const maxChannels = parsePositiveInt(env, 'LOAD_CHANNELS_PER_USER_MAX', { LOAD_CHANNELS_PER_USER_MAX: 4 }, 'users')
  if (minChannels > maxChannels) throw new LoadSafetyError('LOAD_CHANNELS_PER_USER_MIN must be <= LOAD_CHANNELS_PER_USER_MAX')
  const ratio = Number(String(env.LOAD_ACTIVE_SESSION_RATIO ?? '1'))
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new LoadSafetyError('LOAD_ACTIVE_SESSION_RATIO must be a number between 0 and 1')
  }
  return {
    ...common,
    targetUrl: target.url,
    targetRef: target.ref,
    seed: String(env.LOAD_SEED ?? common.runId),
    userCount,
    channelsPerUserMin: minChannels,
    channelsPerUserMax: maxChannels,
    activeSessionRatio: ratio,
    channelTypeDistribution: String(env.LOAD_CHANNEL_TYPE_DISTRIBUTION ?? 'broadcast:1').trim(),
    cleanupOnly: env.LOAD_CLEANUP_ONLY === 'true' || process.argv.includes('--cleanup-only'),
  }
}

export function makeSeededRng(seed) {
  let state = createHash('sha256').update(String(seed)).digest().readUInt32BE(0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function safeRunIdFragment(runId) {
  return runMarker(runId)
}

export function stableId(prefix, runId, index) {
  return `${prefix}_${runMarker(runId)}_${String(index).padStart(6, '0')}`
}

export function syntheticTimestamp(index, base = '2026-01-01T00:00:00.000Z') {
  return new Date(Date.parse(base) + index * 1000).toISOString()
}

export function buildSyntheticSignal({ runId, seed, userId, index }) {
  const rng = makeSeededRng(`${seed}:${index}`)
  const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY']
  const sides = ['buy', 'sell']
  const symbol = symbols[Math.floor(rng() * symbols.length)] ?? 'XAUUSD'
  const action = sides[Math.floor(rng() * sides.length)] ?? 'buy'
  const entry = symbol === 'XAUUSD' ? 2400 + Math.round(rng() * 100) / 10 : 1 + Math.round(rng() * 10000) / 100000
  return {
    id: stableId('loadtest_signal', runId, index),
    user_id: userId,
    channel_id: `loadtest_channel_${createHash('sha256').update(`${runId}:${userId}`).digest('hex').slice(0, 12)}`,
    parsed_data: {
      action,
      symbol,
      lots: 0.01,
      entry_price: entry,
      raw_instruction: `LOAD_TEST ${runId} ${action.toUpperCase()} ${symbol}`,
      load_test: true,
      load_run_id: runId,
      synthetic: true,
    },
    status: 'parsed',
    created_at: syntheticTimestamp(index),
    raw_message: `LOAD_TEST ${runId} synthetic signal ${index}`,
    pipeline_ts: {
      load_test: true,
      load_run_id: runId,
      sequence: index,
    },
  }
}

export function sanitizeError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
}

export async function writeJsonReport(file, data, opts = {}) {
  if (!file) return
  const target = await safeArtifactPath(file, '', opts)
  const fh = await open(target, 'w')
  try {
    await fh.writeFile(`${JSON.stringify(data, null, 2)}\n`)
  } finally {
    await fh.close()
  }
}

export function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}
