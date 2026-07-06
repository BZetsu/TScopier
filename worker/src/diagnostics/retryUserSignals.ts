/**
 * Retry failed/skipped entry signals for a user via worker internal API.
 * Usage: npx ts-node -r dotenv/config src/diagnostics/retryUserSignals.ts <user_id> <signal_id> [signal_id...]
 *
 * Env: WORKER_URL (or TRADE_WORKER_URL), WORKER_INTERNAL_TOKEN
 */
import 'dotenv/config'

async function main() {
  const userId = process.argv[2]?.trim()
  const signalIds = process.argv.slice(3).map(s => s.trim()).filter(Boolean)
  if (!userId || signalIds.length === 0) {
    console.error('usage: retryUserSignals.ts <user_id> <signal_id> [signal_id...]')
    process.exit(1)
  }

  const workerUrl = (
    process.env.TRADE_WORKER_URL
    ?? process.env.WORKER_URL
    ?? process.env.WORKER_PUBLIC_URL
    ?? ''
  ).trim().replace(/\/+$/, '')
  const token = (process.env.WORKER_INTERNAL_TOKEN ?? '').trim()
  if (!workerUrl || !token) {
    console.error('WORKER_URL and WORKER_INTERNAL_TOKEN required')
    process.exit(1)
  }

  const results: Array<{ signalId: string; ok: boolean; body: unknown; status: number }> = []
  for (const signalId of signalIds) {
    const res = await fetch(`${workerUrl}/internal/retry-signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': token,
      },
      body: JSON.stringify({ user_id: userId, signal_id: signalId }),
    })
    let body: unknown = null
    try { body = await res.json() } catch { body = await res.text() }
    results.push({ signalId, ok: res.ok, body, status: res.status })
    console.log(JSON.stringify({ signalId, status: res.status, body }))
  }

  const allOk = results.every(r => r.ok && (r.body as { ok?: boolean })?.ok === true)
  process.exit(allOk ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
