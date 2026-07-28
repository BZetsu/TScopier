// section6-scale-test.js
// Idempotent — safe to re-run. Detects existing auth users and updates in place.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=<prod_key> node scripts/section6-scale-test.js
//
// What it does:
// 1. Read-only export from production (telegram_sessions, telegram_channels, user_profiles)
// 2. Anonymize PII, generate synthetic staging users
// 3. Create auth users in staging (or detect existing ones by email)
// 4. Upsert user_profiles, telegram_sessions (blank session_string), telegram_channels
// 5. Summary
//
// Safety: NEVER exports session_string or phone_number from production.
//          PII in user_profiles is blanked before reaching staging.

const PROD_URL = 'https://sso.tscopier.ai'
const STAGING_URL = 'https://axdcledcyhyvzrnfkwat.supabase.co'

function env(key) {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env: ${key}`)
  return v
}

async function fetchJson(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': opts.headers?.['apikey'] || '',
      ...opts.headers,
    },
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url.split('?')[0]}: ${text.slice(0, 200)}`)
  }
  if (!text) return null
  return JSON.parse(text)
}

// ── Step 1: Export from production (read-only) ──

async function exportProduction(prodKey) {
  console.log('[1/5] Exporting production data...')
  const h = { apikey: prodKey, Authorization: `Bearer ${prodKey}` }

  const sessions = await fetchJson(
    `${PROD_URL}/rest/v1/telegram_sessions?select=id,user_id,is_active&is_active=eq.true`,
    { headers: h },
  )
  console.log(`  → ${sessions.length} active sessions`)

  const userIds = [...new Set(sessions.map(s => s.user_id))]
  console.log(`  → ${userIds.length} unique users`)

  const channels = await fetchJson(
    `${PROD_URL}/rest/v1/telegram_channels?is_active=eq.true&select=*`,
    { headers: h },
  )
  console.log(`  → ${channels.length} active channels`)

  const profiles = await fetchJson(
    `${PROD_URL}/rest/v1/user_profiles?select=*`,
    { headers: h },
  )
  const profileMap = new Map(profiles.map(p => [p.user_id, p]))
  console.log(`  → ${profiles.length} user profiles`)

  return { sessions, channels, profileMap, userIds }
}

// ── Step 2: Build staging user list (before we know actual auth IDs) ──

function buildStagingUsers(prodUserIds, profileMap) {
  console.log('[2/5] Building staging user list...')
  const desired = [] // { desiredId, email, profile, prodUserId }
  const prodToDesired = new Map() // prod user_id → desiredId

  for (const prodId of prodUserIds) {
    const desiredId = crypto.randomUUID()
    prodToDesired.set(prodId, desiredId)
    desired.push({
      desiredId,
      email: `staging-user-${desiredId.slice(0, 8)}@tscopier-scale-test.local`,
      profile: profileMap.get(prodId) || null,
      prodUserId: prodId,
    })
  }
  return { desired, prodToDesired }
}

// ── Step 3: Resolve auth users — fetch existing, create missing ──

async function resolveAuthUsers(stagingKey, desired) {
  console.log('[3/5] Resolving auth users...')

  // Fetch existing synthetic users
  const existing = await fetchJson(
    `${STAGING_URL}/auth/v1/admin/users`,
    { headers: { apikey: stagingKey, Authorization: `Bearer ${stagingKey}` } },
  )
  const usersList = (existing?.users || [])
  const emailToId = new Map()
  for (const u of usersList) {
    if (u.email && u.email.includes('staging-user-')) {
      emailToId.set(u.email, u.id)
    }
  }
  console.log(`  → ${emailToId.size} existing synthetic users found`)

  // Create missing users in batches
  const emailToActualId = new Map(emailToId)
  const toCreate = desired.filter(u => !emailToActualId.has(u.email))
  console.log(`  → ${toCreate.length} new users to create`)

  const batchSize = 10
  for (let i = 0; i < toCreate.length; i += batchSize) {
    const batch = toCreate.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(u =>
        fetchJson(`${STAGING_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: { apikey: stagingKey, Authorization: `Bearer ${stagingKey}` },
          body: JSON.stringify({
            id: u.desiredId,
            email: u.email,
            password: crypto.randomUUID() + 'Aa1!',
            email_confirm: true,
            user_metadata: { synthetic: true },
          }),
        }).then(() => u.desiredId)
      ),
    )
    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === 'fulfilled') {
        emailToActualId.set(batch[j].email, r.value)
      } else {
        console.warn(`  ⚠ Failed to create ${batch[j].email}: ${r.reason?.message || r.reason}`)
      }
    }
    console.log(`  → ${emailToActualId.size} total users resolved`)
  }

  // Build final mapping: prod user_id → actual staging auth user_id
  const prodToStaging = new Map()
  for (const u of desired) {
    const actualId = emailToActualId.get(u.email)
    if (actualId) {
      prodToStaging.set(u.prodUserId, actualId)
    }
  }
  return { prodToStaging, emailToActualId }
}

// ── Step 4: Build insert payloads using actual auth user IDs ──

function buildPayloads(prodData, prodToStaging, profileMap) {
  console.log('[4/5] Building insert payloads...')

  const stagingProfiles = []
  const stagingSessions = []
  const stagingChannels = []

  for (const s of prodData.sessions) {
    const stagingUserId = prodToStaging.get(s.user_id)
    if (!stagingUserId) continue
    stagingSessions.push({
      id: crypto.randomUUID(),
      user_id: stagingUserId,
      session_string: '',
      phone_number: '',
      is_active: true,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })
  }

  for (const ch of prodData.channels) {
    const stagingUserId = prodToStaging.get(ch.user_id)
    if (!stagingUserId) continue
    stagingChannels.push({
      id: crypto.randomUUID(),
      user_id: stagingUserId,
      channel_id: ch.channel_id || '',
      channel_username: ch.channel_username || '',
      display_name: ch.display_name || '',
      is_active: true,
      lot_size_override: ch.lot_size_override || null,
      pip_tolerance_override: ch.pip_tolerance_override || null,
      channel_keywords: ch.channel_keywords || {},
      last_seen_message_id: null,
      last_seen_at: null,
      last_live_at: ch.last_live_at || null,
      signal_channel_id: null,
      created_at: ch.created_at,
      updated_at: ch.updated_at,
    })
  }

  for (const [prodId, stagingUserId] of prodToStaging) {
    const p = profileMap.get(prodId)
    stagingProfiles.push({
      user_id: stagingUserId,
      display_name: `User ${stagingUserId.slice(0, 8)}`,
      first_name: '',
      last_name: '',
      username: `user-${stagingUserId.slice(0, 8)}`,
      country: '',
      city: '',
      mobile_number: '',
      address: '',
      base_currency: p?.base_currency || 'USD',
      timezone: p?.timezone || 'UTC',
      is_admin: false,
      subscription_status: p?.subscription_status || null,
      admin_until: null,
      onboarding_completed_at: p?.onboarding_completed_at || null,
      referred_by_user_id: null,
      email_verified_at: p?.email_verified_at || null,
      copier_paused: p?.copier_paused ?? false,
      notification_sound_enabled: p?.notification_sound_enabled ?? true,
      created_at: p?.created_at || new Date().toISOString(),
      updated_at: p?.updated_at || new Date().toISOString(),
    })
  }

  console.log(`  → ${stagingProfiles.length} profiles, ${stagingSessions.length} sessions, ${stagingChannels.length} channels`)
  return { stagingProfiles, stagingSessions, stagingChannels }
}

// ── Step 5: Upsert into staging ──

async function insertBatches(stagingKey, table, rows) {
  if (rows.length === 0) return
  const batchSize = 50
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await fetchJson(`${STAGING_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: stagingKey,
        Authorization: `Bearer ${stagingKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(batch),
    })
    process.stdout.write('.')
  }
  console.log(' done')
}

async function insertToStaging(stagingKey, payloads) {
  console.log('[5/5] Inserting into staging...')
  console.log('  user_profiles...')
  await insertBatches(stagingKey, 'user_profiles', payloads.stagingProfiles)
  console.log('  telegram_sessions...')
  await insertBatches(stagingKey, 'telegram_sessions', payloads.stagingSessions)
  console.log('  telegram_channels...')
  await insertBatches(stagingKey, 'telegram_channels', payloads.stagingChannels)
}

function printSummary(prodData, prodToStaging, payloads) {
  console.log('')
  console.log('=== Summary ===')
  console.log(`  Production users mirrored: ${prodToStaging.size}/${prodData.userIds.length}`)
  console.log(`  Profiles inserted/updated: ${payloads.stagingProfiles.length}`)
  console.log(`  Sessions (blank string): ${payloads.stagingSessions.length}`)
  console.log(`  Channels remapped: ${payloads.stagingChannels.length}`)
  console.log('')
  console.log('Next: Restart staging Railway listener (6.3) and monitor for 4h (6.4).')
}

// ── Main ──

async function main() {
  const prodKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const stagingKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4ZGNsZWRjeWh5dnpybmZrd2F0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDgwMDI3MywiZXhwIjoyMTAwMzc2MjczfQ.-aT3FeWepkotrJS_dEyLyNWHfJNKuWBtTpSjhsIZf24'

  console.log('=== TScopier Section 6 Scale Test Setup ===')
  console.log('')

  const prodData = await exportProduction(prodKey)
  if (prodData.userIds.length === 0) {
    console.log('No active sessions found — nothing to copy.')
    return
  }

  const { desired, prodToDesired } = buildStagingUsers(prodData.userIds, prodData.profileMap)
  const { prodToStaging } = await resolveAuthUsers(stagingKey, desired)
  if (prodToStaging.size === 0) {
    console.log('No staging users resolved — aborting.')
    return
  }

  const payloads = buildPayloads(prodData, prodToStaging, prodData.profileMap)
  await insertToStaging(stagingKey, payloads)
  printSummary(prodData, prodToStaging, payloads)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
