import {
  assertCommonSafety,
  assertSafeSupabaseUrl,
  readLimitedText,
  runMarker,
  validateRunId,
  LoadSafetyError,
  sanitizeError,
} from './load-safety.mjs'

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    redirect: 'manual',
  })
  if (res.status >= 300 && res.status < 400) {
    throw new LoadSafetyError(`Redirect rejected from ${new URL(url).pathname}`)
  }
  const text = await readLimitedText(res).catch(() => '')
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}: ${text.slice(0, 200)}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new LoadSafetyError(`Invalid JSON from ${new URL(url).pathname}`)
  }
}

export function authHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  }
}

export function runSignalIdLike(runId) {
  return `loadtest_signal_${runMarker(runId)}_*`
}

function cleanupConfirmed(env, explicit) {
  return explicit === true || String(env.LOAD_CLEANUP_CONFIRM ?? '').toLowerCase() === 'true'
}

function validateCleanupContext({ supabaseUrl, runId, env = process.env, confirmDelete = false }) {
  const common = assertCommonSafety(env)
  const validRunId = validateRunId(runId)
  assertSafeSupabaseUrl(supabaseUrl, env, 'cleanup Supabase URL')
  if (common.cleanupPolicy !== 'auto' && common.cleanupPolicy !== 'manual') {
    throw new LoadSafetyError('Cleanup requires LOAD_CLEANUP_POLICY=auto or manual')
  }
  const cleanupMode = env.LOAD_CLEANUP_ONLY === 'true'
    || process.argv.includes('--cleanup-only')
    || common.cleanupPolicy === 'auto'
  if (!cleanupMode) throw new LoadSafetyError('Cleanup mode must be explicitly requested')
  return {
    runId: validRunId,
    marker: runMarker(validRunId),
    dryRun: !cleanupConfirmed(env, confirmDelete),
  }
}

function assertRowsTagged(rows, table, marker, columns) {
  if (!columns.length) return
  for (const row of rows ?? []) {
    const haystack = columns.map(c => String(row?.[c] ?? '')).join(' ')
    if (!haystack.includes(marker)) {
      throw new LoadSafetyError(`Cleanup candidate in ${table} is not tagged with the exact run marker`)
    }
  }
}

async function selectRows(baseUrl, key, table, query, select = 'id') {
  const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${query}`
  const res = await fetch(url, {
    headers: authHeaders(key, { Prefer: 'count=exact' }),
    redirect: 'manual',
  })
  if (res.status >= 300 && res.status < 400) throw new LoadSafetyError(`Redirect rejected counting ${table}`)
  const text = await readLimitedText(res).catch(() => '')
  if (!res.ok) throw new Error(`HTTP ${res.status} counting ${table}`)
  const range = res.headers.get('content-range') ?? ''
  const count = Number(range.split('/')[1] ?? 0)
  let rows = []
  if (text) {
    try { rows = JSON.parse(text) } catch { throw new LoadSafetyError(`Invalid JSON counting ${table}`) }
  }
  return { rows: Array.isArray(rows) ? rows : [], count: Number.isFinite(count) ? count : 0 }
}

async function deleteRows(baseUrl, key, table, query, opts) {
  const { rows, count } = await selectRows(baseUrl, key, table, query, opts.select)
  assertRowsTagged(rows, table, opts.marker, opts.markerColumns)
  if (count === 0) return { table, targeted: 0, deleted: 0, dry_run: opts.dryRun }
  if (opts.dryRun) return { table, targeted: count, deleted: 0, dry_run: true }
  const res = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: authHeaders(key, { Prefer: 'return=minimal' }),
    redirect: 'manual',
  })
  if (res.status >= 300 && res.status < 400) throw new LoadSafetyError(`Redirect rejected deleting ${table}`)
  if (!res.ok) {
    const text = await readLimitedText(res).catch(() => '')
    throw new Error(`HTTP ${res.status} deleting ${table}: ${text.slice(0, 200)}`)
  }
  return { table, targeted: count, deleted: count, dry_run: false }
}

export async function cleanupBurstRun({ supabaseUrl, serviceRoleKey, runId, env = process.env, confirmDelete = false }) {
  const ctx = validateCleanupContext({ supabaseUrl, runId, env, confirmDelete })
  const like = encodeURIComponent(runSignalIdLike(runId))
  const signalFilter = `signal_id=like.${like}`
  const idFilter = `id=like.${like}`
  const results = []
  for (const [table, query] of [
    ['partial_tp_legs', signalFilter],
    ['range_pending_legs', signalFilter],
    ['trade_execution_logs', signalFilter],
    ['trades', signalFilter],
    ['signals', idFilter],
  ]) {
    try {
      const idColumn = table === 'signals' ? 'id' : 'signal_id'
      results.push(await deleteRows(supabaseUrl, serviceRoleKey, table, query, {
        marker: ctx.marker,
        markerColumns: [idColumn],
        select: idColumn,
        dryRun: ctx.dryRun,
      }))
    } catch (err) {
      results.push({ table, targeted: 0, deleted: 0, error: sanitizeError(err) })
    }
  }
  return results
}

export async function cleanupSection6Run({ supabaseUrl, serviceRoleKey, runId, env = process.env, confirmDelete = false, createdUsers = [] }) {
  const ctx = validateCleanupContext({ supabaseUrl, runId, env, confirmDelete })
  const marker = ctx.marker
  const usernameLike = encodeURIComponent(`loadtest_${marker}_*`)
  const results = []
  const profileRows = await fetchJson(
    `${supabaseUrl}/rest/v1/user_profiles?select=user_id,username&username=like.${usernameLike}`,
    { headers: authHeaders(serviceRoleKey) },
  )
  assertRowsTagged(profileRows ?? [], 'user_profiles', marker, ['username'])
  const discoveredUserIds = (profileRows ?? [])
    .map(row => String(row.user_id ?? '').trim())
    .filter(Boolean)
  const exactCreated = (createdUsers ?? [])
    .map(row => typeof row === 'string' ? row : String(row?.userId ?? row?.user_id ?? '').trim())
    .filter(Boolean)
  const userIds = [...new Set([...discoveredUserIds, ...exactCreated])]
  if (!userIds.length) {
    return [
      { table: 'user_profiles', targeted: 0, deleted: 0, dry_run: ctx.dryRun, note: 'No tagged synthetic profiles found' },
    ]
  }
  const userFilter = `user_id=in.(${userIds.join(',')})`
  for (const [table, query] of [
    ['telegram_channels', userFilter],
    ['telegram_sessions', userFilter],
    ['user_profiles', userFilter],
  ]) {
    results.push(await deleteRows(supabaseUrl, serviceRoleKey, table, query, {
      marker,
      markerColumns: table === 'user_profiles' ? ['username'] : [],
      select: table === 'user_profiles' ? 'user_id,username' : 'user_id',
      dryRun: ctx.dryRun,
    }))
  }
  for (const userId of userIds) {
    if (ctx.dryRun) {
      results.push({ table: 'auth.users', targeted: 1, deleted: 0, dry_run: true, user_id: userId })
      continue
    }
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: authHeaders(serviceRoleKey),
      redirect: 'manual',
    })
    results.push({
      table: 'auth.users',
      targeted: 1,
      deleted: res.ok ? 1 : 0,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    })
  }
  return results
}
