#!/usr/bin/env node
/**
 * Shard fleet readiness check (no Railway mutations).
 *
 * Usage:
 *   node scripts/diagnostics/shard_fleet_check.mjs \
 *     --user-id <uuid> \
 *     --listener-urls https://l0.up.railway.app,https://l1.up.railway.app \
 *     [--trade-urls https://t0.up.railway.app,https://t1.up.railway.app] \
 *     [--token <WORKER_INTERNAL_TOKEN>]
 *
 * Prints the user's shard index, curls each listener /health for shard labels,
 * and optionally POSTs a dry dispatch to confirm wrong_shard on the wrong trade shard.
 */

function parseArgs(argv) {
  const out = {
    userId: '',
    listenerUrls: [],
    tradeUrls: [],
    token: process.env.WORKER_INTERNAL_TOKEN ?? '',
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--user-id' && next) {
      out.userId = next
      i++
    } else if (a === '--listener-urls' && next) {
      out.listenerUrls = next.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
      i++
    } else if (a === '--trade-urls' && next) {
      out.tradeUrls = next.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
      i++
    } else if (a === '--token' && next) {
      out.token = next
      i++
    } else if (a === '--help' || a === '-h') {
      out.help = true
    }
  }
  return out
}

/** Must match worker shardForUserId / Edge _shared/workerShard.ts */
function shardForUserId(userId, shardCount) {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(h) % Math.max(1, shardCount)
}

async function fetchJson(url, opts = {}, timeoutMs = 12_000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    return { ok: res.ok, status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.userId || args.listenerUrls.length === 0) {
    console.log(`Usage:
  node scripts/diagnostics/shard_fleet_check.mjs \\
    --user-id <uuid> \\
    --listener-urls url0,url1[,urlN] \\
    [--trade-urls url0,url1] \\
    [--token WORKER_INTERNAL_TOKEN]

Env fallback: WORKER_INTERNAL_TOKEN
`)
    process.exit(args.help ? 0 : 1)
  }

  const n = args.listenerUrls.length
  const shard = shardForUserId(args.userId, n)
  console.log(`user_id=${args.userId}`)
  console.log(`shard_index=${shard} of ${n} (hash % ${n})`)
  console.log(`expected_listener=${args.listenerUrls[shard]}`)
  if (args.tradeUrls.length === n) {
    console.log(`expected_trade=${args.tradeUrls[shard]}`)
  } else if (args.tradeUrls.length > 0) {
    console.warn(`trade URL count (${args.tradeUrls.length}) != listener count (${n}) — skip trade routing assert`)
  }

  let failed = false
  for (let i = 0; i < args.listenerUrls.length; i++) {
    const base = args.listenerUrls[i]
    const { ok, status, body } = await fetchJson(`${base}/health`)
    const label = body?.shard ?? body?.detail?.shard ?? null
    const userPresent = Array.isArray(body?.detail)
      ? body.detail.some((d) => d?.user_id === args.userId)
      : null
    console.log(
      `[listener ${i}] status=${status} ok=${ok} shard_field=${JSON.stringify(label)}`
      + ` user_present=${userPresent}`,
    )
    if (!ok) failed = true
    if (i === shard && userPresent === false) {
      console.warn(`  warn: owning shard health did not list this user (may be offline / no session)`)
    }
    if (i !== shard && userPresent === true) {
      console.warn(`  warn: user listed on non-owning shard ${i} — check WORKER_SHARD_*`)
      failed = true
    }
  }

  if (args.tradeUrls.length === n && args.token) {
    const wrong = (shard + 1) % n
    const target = args.tradeUrls[wrong]
    const { status, body } = await fetchJson(`${target}/internal/dispatch-signal`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': args.token,
      },
      body: JSON.stringify({
        signal: {
          id: '00000000-0000-4000-8000-000000000099',
          user_id: args.userId,
          status: 'parsed',
          parsed_data: { action: 'ignore' },
        },
        source: 'shard_fleet_check',
      }),
    })
    const reason = body?.reason ?? body?.error ?? null
    console.log(`[trade wrong_shard probe] shard=${wrong} status=${status} reason=${reason}`)
    if (reason !== 'wrong_shard' && body?.accepted !== false) {
      console.warn('  warn: expected wrong_shard rejection from non-owning trade shard')
      failed = true
    }
  } else if (args.tradeUrls.length === n && !args.token) {
    console.log('[trade wrong_shard probe] skipped (pass --token or WORKER_INTERNAL_TOKEN)')
  }

  process.exit(failed ? 2 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
