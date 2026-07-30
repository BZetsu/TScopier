#!/usr/bin/env node
/**
 * Section 6 database/session-manager scale setup.
 *
 * This creates blank synthetic Telegram session rows in an isolated target
 * Supabase project. Blank sessions exercise database/session-manager scale and
 * invalid-session handling only; they do not simulate real Telegram connectivity.
 */

import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  safeRunIdFragment,
  makeSeededRng,
  readLimitedText,
  sanitizeError,
  safeArtifactPath,
  syntheticTimestamp,
  validateSection6Config,
} from './load/load-safety.mjs'
import {
  authHeaders,
  cleanupSection6Run,
  fetchJson,
} from './load/load-cleanup.mjs'

function deterministicUuid(parts) {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function apiBase(url) {
  return String(url).replace(/\/$/, '')
}

function parseChannelTypeDistribution(raw) {
  const entries = String(raw ?? 'broadcast:1')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [name, weightRaw] = part.split(':')
      const weight = Number(weightRaw ?? 1)
      return {
        name: String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'broadcast',
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
      }
    })
  return entries.length ? entries : [{ name: 'broadcast', weight: 1 }]
}

function pickWeighted(rng, entries) {
  const total = entries.reduce((sum, item) => sum + item.weight, 0)
  let cursor = rng() * total
  for (const item of entries) {
    cursor -= item.weight
    if (cursor <= 0) return item.name
  }
  return entries[entries.length - 1].name
}

function buildSyntheticUsers(config) {
  const fragment = safeRunIdFragment(config.runId)
  return Array.from({ length: config.userCount }, (_, index) => ({
    userId: deterministicUuid(['loadtest-user', config.runId, String(index)]),
    email: `loadtest-${fragment}-${String(index).padStart(4, '0')}@tscopier-scale-test.local`,
    username: `loadtest_${fragment}_${String(index).padStart(4, '0')}`,
  }))
}

async function resolveAuthUsers(config, targetKey, users) {
  console.log('[2/5] Creating deterministic synthetic auth users...')
  const base = apiBase(config.targetUrl)
  const h = authHeaders(targetKey)
  let created = 0
  for (const user of users) {
    const password = `${randomUUID()}Aa1!`
    const res = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        id: user.userId,
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: {
          synthetic: true,
          load_test: true,
          load_run_id: config.runId,
        },
      }),
    })
    if (res.ok) {
      created += 1
      continue
    }
    const text = await readLimitedText(res).catch(() => '')
    if (!text.toLowerCase().includes('already') && res.status !== 422) {
      throw new Error(`Failed to create synthetic auth user ${user.email}: HTTP ${res.status}`)
    }
  }
  console.log(`  auth users created=${created} existing=${users.length - created}`)
}

function buildPayloads(config, syntheticUsers) {
  console.log('[3/5] Building tagged synthetic rows...')
  const rng = makeSeededRng(config.seed)
  const channelTypes = parseChannelTypeDistribution(config.channelTypeDistribution)
  const profiles = []
  const sessions = []
  const channels = []

  for (const [userIndex, user] of syntheticUsers.entries()) {
    profiles.push({
      user_id: user.userId,
      display_name: `Load Test ${safeRunIdFragment(config.runId)} ${user.username.slice(-4)}`,
      first_name: '',
      last_name: '',
      username: user.username,
      country: '',
      city: '',
      mobile_number: '',
      address: '',
      base_currency: 'USD',
      timezone: 'UTC',
      is_admin: false,
      subscription_status: 'load_test',
      admin_until: null,
      onboarding_completed_at: syntheticTimestamp(0),
      referred_by_user_id: null,
      email_verified_at: syntheticTimestamp(0),
      copier_paused: false,
      notification_sound_enabled: true,
      created_at: syntheticTimestamp(0),
      updated_at: syntheticTimestamp(0),
    })

    const active = rng() <= config.activeSessionRatio
    sessions.push({
      id: deterministicUuid(['loadtest-session', config.runId, user.userId]),
      user_id: user.userId,
      session_string: '',
      phone_number: '',
      is_active: active,
      created_at: syntheticTimestamp(userIndex),
      updated_at: syntheticTimestamp(userIndex),
    })

    const span = config.channelsPerUserMax - config.channelsPerUserMin + 1
    const channelCount = config.channelsPerUserMin + Math.floor(rng() * span)
    for (let j = 0; j < channelCount; j += 1) {
      const index = channels.length
      const channelType = pickWeighted(rng, channelTypes)
      channels.push({
        id: deterministicUuid(['loadtest-channel', config.runId, user.userId, String(j)]),
        user_id: user.userId,
        channel_id: `loadtest_${safeRunIdFragment(config.runId)}_${String(index).padStart(4, '0')}`,
        channel_username: '',
        display_name: `Load Test ${config.runId} ${channelType} Channel ${index + 1}`,
        is_active: true,
        lot_size_override: null,
        pip_tolerance_override: null,
        channel_keywords: {
          load_test: true,
          load_run_id: config.runId,
          synthetic: true,
          channel_type: channelType,
        },
        last_seen_message_id: null,
        last_seen_at: null,
        last_live_at: null,
        signal_channel_id: null,
        created_at: syntheticTimestamp(index),
        updated_at: syntheticTimestamp(index),
      })
    }
  }

  return { profiles, sessions, channels }
}

async function insertBatches(config, targetKey, table, rows) {
  if (!rows.length) return 0
  const base = apiBase(config.targetUrl)
  const batchSize = 50
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await fetchJson(`${base}/rest/v1/${table}`, {
      method: 'POST',
      headers: authHeaders(targetKey, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(batch),
    })
    inserted += batch.length
  }
  return inserted
}

async function writeManifest(config, syntheticUsers, payloads) {
  const reportFile = await safeArtifactPath(process.env.LOAD_REPORT_FILE, `section6-${config.runId}.json`, {
    allowOverwrite: process.env.LOAD_REPORT_OVERWRITE === 'true',
  })
  const manifest = {
    run_id: config.runId,
    seed: config.seed,
    target_ref: config.targetRef,
    users: syntheticUsers.map(u => ({ user_id: u.userId, email: u.email, username: u.username })),
    row_counts: {
      user_profiles: payloads.profiles.length,
      telegram_sessions: payloads.sessions.length,
      telegram_channels: payloads.channels.length,
    },
    note: 'Blank session_string rows test database/session-manager scale only, not real Telegram connectivity.',
  }
  await writeFile(reportFile, `${JSON.stringify(manifest, null, 2)}\n`)
  return reportFile
}

async function insertToTarget(config, targetKey, payloads) {
  console.log('[4/5] Inserting tagged synthetic rows into target...')
  const userProfiles = await insertBatches(config, targetKey, 'user_profiles', payloads.profiles)
  const telegramSessions = await insertBatches(config, targetKey, 'telegram_sessions', payloads.sessions)
  const telegramChannels = await insertBatches(config, targetKey, 'telegram_channels', payloads.channels)
  return { user_profiles: userProfiles, telegram_sessions: telegramSessions, telegram_channels: telegramChannels }
}

async function main() {
  const config = validateSection6Config(process.env)
  const targetKey = String(process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

  console.log('=== TScopier Section 6 isolated scale setup ===')
  console.log(`run_id=${config.runId} seed=${config.seed} target_ref=${config.targetRef}`)
  console.log(`synthetic shape users=${config.userCount} channels_per_user=${config.channelsPerUserMin}-${config.channelsPerUserMax}`)
  console.log('Blank Telegram sessions test DB/session-manager scale only; they do not test real Telegram connectivity.')

  if (config.cleanupOnly) {
    const cleanup = await cleanupSection6Run({
      supabaseUrl: apiBase(config.targetUrl),
      serviceRoleKey: targetKey,
      runId: config.runId,
      confirmDelete: process.argv.includes('--confirm-delete'),
    })
    console.log(JSON.stringify({ run_id: config.runId, cleanup }, null, 2))
    return
  }

  let payloads = null
  let syntheticUsers = []
  try {
    console.log('[1/5] Generating synthetic production-shaped aggregate data...')
    syntheticUsers = buildSyntheticUsers(config)
    await resolveAuthUsers(config, targetKey, syntheticUsers)
    payloads = buildPayloads(config, syntheticUsers)
    const inserted = await insertToTarget(config, targetKey, payloads)
    const manifest = await writeManifest(config, syntheticUsers, payloads)
    console.log('[5/5] Summary')
    console.log(JSON.stringify({
      run_id: config.runId,
      seed: config.seed,
      inserted,
      manifest,
      cleanup: config.cleanupPolicy,
    }, null, 2))
  } catch (err) {
    console.error(`Fatal: ${sanitizeError(err)}`)
    if (syntheticUsers.length > 0 && config.cleanupPolicy === 'auto') {
      console.error('Attempting automatic cleanup for tagged synthetic rows...')
      const cleanup = await cleanupSection6Run({
        supabaseUrl: apiBase(config.targetUrl),
        serviceRoleKey: targetKey,
        runId: config.runId,
        confirmDelete: process.argv.includes('--confirm-delete'),
        createdUsers: syntheticUsers,
      })
      console.error(JSON.stringify({ run_id: config.runId, cleanup }, null, 2))
    }
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(err => {
    console.error(`Fatal: ${sanitizeError(err)}`)
    process.exit(1)
  })
}

export {
  buildPayloads,
  buildSyntheticUsers,
  deterministicUuid,
}
