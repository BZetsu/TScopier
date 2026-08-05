/**
 * signal-reconcile-sweep — cron backup for Telegram signal text reconciliation.
 *
 * Worker UserListener runs reconcile every 60s (primary). This edge function runs
 * every 2 minutes and POSTs to the listener worker for users with open trades.
 */

// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// @ts-ignore Deno globals
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

/** Accept host-only Railway URLs — fetch requires a scheme (same as telegram-auth). */
function normalizeWorkerBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const WORKER_URL = normalizeWorkerBaseUrl(
  Deno.env.get("TELEGRAM_LISTENER_URL") ?? Deno.env.get("WORKER_URL") ?? "",
)
const WORKER_INTERNAL_TOKEN = Deno.env.get("WORKER_INTERNAL_TOKEN") ?? ""
const LOOKBACK_HOURS = 24
const MAX_USERS = 40
/** Keep well under pg_net's ~55s hard cap across concurrent listener calls. */
const PER_USER_TIMEOUT_MS = 8_000
const CONCURRENCY = 5

async function reconcileUser(userId: string): Promise<Record<string, unknown>> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PER_USER_TIMEOUT_MS)
  try {
    const res = await fetch(`${WORKER_URL}/internal/reconcile-signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": WORKER_INTERNAL_TOKEN,
      },
      body: JSON.stringify({ user_id: userId }),
      signal: ac.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.ok !== false) {
      return { user_id: userId, ok: true, stats: data?.stats ?? null }
    }
    return { user_id: userId, ok: false, reason: data?.reason ?? data?.error ?? res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      user_id: userId,
      ok: false,
      error: msg.includes("abort") ? `timeout_after_${PER_USER_TIMEOUT_MS}ms` : msg,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return out
}

Deno.serve(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), { status: 500 })
  }
  if (!WORKER_URL || !WORKER_INTERNAL_TOKEN) {
    return new Response(JSON.stringify({ error: "WORKER_URL or WORKER_INTERNAL_TOKEN not configured" }), {
      status: 503,
    })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()

  const { data: openTrades, error: tradesErr } = await supabase
    .from("trades")
    .select("user_id")
    .eq("status", "open")
    .gte("opened_at", since)
    .limit(500)

  if (tradesErr) {
    return new Response(JSON.stringify({ error: tradesErr.message }), { status: 500 })
  }

  const userIds = [...new Set(
    (openTrades ?? [])
      .map((r) => String((r as { user_id?: string }).user_id ?? ""))
      .filter(Boolean),
  )].slice(0, MAX_USERS)

  const results = userIds.length
    ? await mapPool(userIds, CONCURRENCY, reconcileUser)
    : []

  const triggered = results.filter((r) => r.ok === true).length
  const skipped = results.length - triggered

  return new Response(
    JSON.stringify({
      users_considered: userIds.length,
      triggered,
      skipped,
      worker_url: WORKER_URL,
      results,
    }),
    { headers: { "Content-Type": "application/json" } },
  )
})
