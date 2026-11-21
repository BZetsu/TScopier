import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { logAssistantEvent } from "../_shared/listenerEvents.ts"
import {
  buildAuthActionDetail,
  classifyAuthActionOutcome,
  redactWorkerUrls,
  type AuthActionOutcome,
} from "../_shared/authActionEvent.ts"
import {
  hasListenerWorkerUrl,
  isWrongShardPayload,
  listenerWorkerUrlCandidates,
} from "../_shared/workerShard.ts"

/**
 * Thin proxy in front of the worker's MTProto auth API.
 *
 * Why this is no longer an MTProto client itself:
 *   The previous version connected to Telegram directly from the Supabase
 *   Edge runtime. Each call (send_code / verify_code / list_channels) opened
 *   and closed a fresh TelegramClient from a Supabase egress IP, which was
 *   then handed off to the worker on a different cloud IP. That IP/DC churn
 *   is the strongest "userbot from datacenter" signal Telegram's anti-spam
 *   uses, and was the immediate cause of the previous account ban.
 *
 *   The worker is now the single owner of every MTProto socket. This edge
 *   function only authenticates the Supabase user and forwards the request.
 *   With LISTENER_SHARD_URLS set, each user is routed to their owning shard.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  // `x-client-id` is sent by the app (one id per browser tab) so events written by
  // the worker can name the caller. A custom header forces a preflight, so it must
  // be listed here or the browser blocks every Telegram auth call.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Client-Id",
}

const WORKER_INTERNAL_TOKEN = Deno.env.get("WORKER_INTERNAL_TOKEN") ?? ""

const ROUTES: Record<string, string> = {
  send_code: "/auth/send_code",
  resend_code: "/auth/resend_code",
  verify_code: "/auth/verify_code",
  start_qr_login: "/auth/start_qr",
  poll_qr_login: "/auth/qr_status",
  verify_qr_password: "/auth/verify_qr_password",
  list_channels: "/auth/list_channels",
  reconnect_telegram: "/auth/reconnect_telegram",
  disconnect_telegram: "/auth/disconnect_telegram",
  backfill_channel_history: "/auth/backfill_channel_history",
}

/**
 * Actions a support conversation asks about. Polling actions (qr_status,
 * list_channels) would bury them, so they are not traced.
 */
const TRACED_AUTH_ACTIONS = new Set([
  "send_code",
  "verify_code",
  "start_qr_login",
  "reconnect_telegram",
  "disconnect_telegram",
])

/**
 * Bound the listener call. A worker that accepts the connection but never
 * answers must not hang the browser, and must still leave a trace row.
 */
const WORKER_TIMEOUT_MS = 30_000

/**
 * Run a diagnostic write without holding the response back. `waitUntil` keeps
 * the isolate alive until the insert lands; without it a `void` promise can be
 * dropped when the response is flushed.
 */
function scheduleBackgroundTask(promise: Promise<unknown>): void {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(task: Promise<unknown>): void }
  }).EdgeRuntime
  if (runtime?.waitUntil) {
    runtime.waitUntil(promise)
    return
  }
  void promise
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders })
    }

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders })
    }

    if (!hasListenerWorkerUrl() || !WORKER_INTERNAL_TOKEN) {
      console.error("telegram-auth: LISTENER_SHARD_URLS/TELEGRAM_LISTENER_URL or WORKER_INTERNAL_TOKEN not configured")
      return Response.json(
        { error: "Telegram service is not configured. Contact support." },
        { status: 503, headers: corsHeaders },
      )
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? "")
    const path = ROUTES[action]
    if (!path) {
      return Response.json({ error: "Unknown action" }, { status: 400, headers: corsHeaders })
    }

    // Who is calling: a per-tab client id (when the app is built with it), the
    // edge-visible client IP and the browser. Forwarded to the worker so events it
    // writes (for example a disconnect) name the caller, and logged here because
    // request bodies and actions were previously invisible in the gateway log.
    const forwardedFor = req.headers.get("x-forwarded-for") ?? ""
    const clientIp = (req.headers.get("cf-connecting-ip") ?? forwardedFor.split(",")[0] ?? "").trim()
    const clientId = (req.headers.get("x-client-id") ?? "").trim().slice(0, 64) || "-"
    const ua = (req.headers.get("user-agent") ?? "").trim().slice(0, 120)
    console.log(
      `[telegram-auth] action=${action} user=${user.id} client=${clientId} ip=${clientIp || "-"} ua=${ua || "-"}`,
    )
    // Only the actions a support conversation would ask about. Polling actions
    // (qr_status, list_channels) would bury them.
    //
    // The event is written AFTER the worker answers, so it records the outcome.
    // It used to be written before forwarding, which made a rejected call (for
    // example `wrong_shard`) look like a successful reconnect in the admin panel.
    // Scheduled, not awaited: a slow insert must not delay or fail an auth call.
    const traceAuthAction = (outcome: AuthActionOutcome): void => {
      if (!TRACED_AUTH_ACTIONS.has(action)) return
      scheduleBackgroundTask(
        logAssistantEvent({
          userId: user.id,
          eventType: "telegram_auth_action",
          detail: buildAuthActionDetail({ action, clientId, ip: clientIp, ua, outcome }),
        }).catch(() => {
          // Diagnostics must never break the auth call itself.
        }),
      )
    }

    const rest = { ...body }
    delete rest.action
    delete rest.phone_code_hash
    delete rest.session_string
    // The authenticated caller is the acting user on every route downstream.
    // Without this, a client-supplied user_id would survive the spread below
    // and let any signed-in user act as (and link Telegram as) someone else.
    delete rest.user_id

    const candidates = listenerWorkerUrlCandidates(user.id)
    if (candidates.length === 0) {
      console.error("telegram-auth: no listener URL for user shard")
      traceAuthAction({ ok: false, reason: "no_listener_url" })
      return Response.json(
        { error: "Telegram service is not configured. Contact support." },
        { status: 503, headers: corsHeaders },
      )
    }

    const forwardHeaders: Record<string, string> = {
      "content-type": "application/json",
      "x-internal-token": WORKER_INTERNAL_TOKEN,
      // Caller identity for the events the worker writes (e.g. a disconnect).
      ...(clientId !== "-" ? { "x-client-id": clientId } : {}),
      ...(clientIp ? { "x-client-ip": clientIp } : {}),
      ...(ua ? { "x-client-ua": ua } : {}),
    }
    const forwardBody = JSON.stringify({ user_id: user.id, ...rest })

    // Primary shard first. If LISTENER_SHARD_URLS.length disagrees with listener
    // WORKER_SHARD_COUNT, the hash index is wrong and the worker returns
    // wrong_shard — retry other fleet URLs so auth can still complete.
    let workerRes: Response | null = null
    let payload: unknown = null
    for (let i = 0; i < candidates.length; i++) {
      const workerUrl = candidates[i]!
      try {
        workerRes = await fetch(`${workerUrl}${path}`, {
          method: "POST",
          headers: forwardHeaders,
          body: forwardBody,
          signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const timedOut = err instanceof DOMException && err.name === "TimeoutError"
        console.warn(
          `[telegram-auth] listener fetch ${timedOut ? "timed out" : "failed"} url=${workerUrl} action=${action}: ${message}`,
        )
        // Final attempt failed: record why (timeout vs. network error) and rethrow.
        // Earlier attempts fall through to the next listener URL.
        if (i === candidates.length - 1) {
          traceAuthAction({
            ok: false,
            reason: timedOut ? "fetch_timeout" : "fetch_failed",
            // Never persist shard hostnames: the row is readable by its owner.
            error: redactWorkerUrls(message),
          })
          throw err
        }
        continue
      }
      const text = await workerRes.text()
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        payload = { error: "Invalid response from Telegram service" }
      }
      if (isWrongShardPayload(payload) && i < candidates.length - 1) {
        console.warn(
          `telegram-auth: wrong_shard from ${workerUrl} action=${action} user=${user.id}; trying next listener`,
        )
        continue
      }
      if (i > 0) {
        console.warn(
          `telegram-auth: recovered via fallback listener ${workerUrl} (primary was ${candidates[0]}) action=${action} user=${user.id}`,
        )
      }
      break
    }

    if (!workerRes) {
      return Response.json(
        { error: "Telegram service is not configured. Contact support." },
        { status: 503, headers: corsHeaders },
      )
    }

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const rec = payload as Record<string, unknown>
      if (typeof rec.error === "string") {
        rec.error = String(rec.error).replace(/\s*\(caused by[\s\S]*$/i, "").trim()
      }
      if (typeof rec.message === "string") {
        rec.message = String(rec.message).replace(/\s*\(caused by[\s\S]*$/i, "").trim()
      }
    }

    // Record the outcome of the action itself, so support can tell a request
    // that the worker accepted from one it rejected (for example wrong_shard).
    const outcome = classifyAuthActionOutcome(workerRes.status, workerRes.ok, payload)
    traceAuthAction(outcome)

    // Log every Telegram linking attempt with its outcome so we can see whether
    // the code was actually sent (delivery), how long it was, and why it failed.
    if (action === "send_code" || action === "verify_code") {
      const rec = (payload && typeof payload === "object" && !Array.isArray(payload))
        ? payload as Record<string, unknown>
        : undefined
      const detail: Record<string, unknown> = {
        action,
        phone: typeof rest.phone === "string" ? rest.phone.slice(0, 4) + "****" : undefined,
        ok: outcome.ok,
      }
      if (rec) {
        if (typeof rec.delivery === "string") detail.delivery = rec.delivery
        if (typeof rec.code_length === "number") detail.code_length = rec.code_length
        if (typeof rec.can_resend === "boolean") detail.can_resend = rec.can_resend
        if (typeof rec.requires_password === "boolean") detail.requires_password = rec.requires_password
        if (typeof rec.error === "string") detail.error = rec.error
      }
      logAssistantEvent({
        userId: user.id,
        eventType: "telegram_link_attempt",
        detail,
      }).catch(() => {}); // fire-and-forget
    }

    return new Response(JSON.stringify(payload), {
      status: workerRes.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("telegram-auth proxy error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
