import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const SUPPORTED_PROVIDERS = new Set([
  "fxsocket",
  "mtapi",
  "ctrader",
  "binance",
  "bybit",
  "kucoin",
  "dxtrade",
  "tradelocker",
  "matchtrader",
])

type BrokerSessionRow = {
  provider?: string | null
  mtapi_session_id?: string | null
  fxsocket_account_id?: string | null
  metaapi_account_id?: string | null
  ctrader_account_id?: string | null
  binance_account_id?: string | null
  bybit_account_id?: string | null
  kucoin_account_id?: string | null
  dxtrade_account_id?: string | null
  tradelocker_account_id?: string | null
  matchtrader_account_id?: string | null
}

function bad(status: number, msg: string) {
  return Response.json({ error: msg }, { status, headers: corsHeaders })
}

function normalizeChannelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(id => String(id ?? "").trim()).filter(Boolean)
}

/** Mirror worker `brokerSessionId` — reject accounts with no live provider session. */
function providerSessionId(broker: BrokerSessionRow): string {
  const provider = String(broker.provider ?? "fxsocket").trim() || "fxsocket"
  const pick = (value: unknown) => {
    const id = String(value ?? "").trim()
    return id && !id.includes("|") ? id : ""
  }
  if (provider === "mtapi") return pick(broker.mtapi_session_id)
  if (provider === "ctrader") return pick(broker.ctrader_account_id)
  if (provider === "binance") return pick(broker.binance_account_id)
  if (provider === "bybit") return pick(broker.bybit_account_id)
  if (provider === "kucoin") return pick(broker.kucoin_account_id)
  if (provider === "dxtrade") return pick(broker.dxtrade_account_id)
  if (provider === "tradelocker") return pick(broker.tradelocker_account_id)
  if (provider === "matchtrader") return pick(broker.matchtrader_account_id)
  if (provider !== "fxsocket") return ""
  return pick(broker.fxsocket_account_id) || pick(broker.metaapi_account_id)
}

async function callWorkerForceClose(args: {
  userId: string
  brokerAccountId?: string | null
  channelId?: string | null
  signalId?: string | null
}): Promise<Record<string, unknown>> {
  const workerUrl = (
    Deno.env.get("TRADE_WORKER_URL")
    ?? Deno.env.get("WORKER_URL")
    ?? Deno.env.get("WORKER_PUBLIC_URL")
    ?? ""
  ).trim().replace(/\/+$/, "")
  const token = (Deno.env.get("WORKER_INTERNAL_TOKEN") ?? "").trim()
  if (!workerUrl || !token) {
    return { ok: false, error: "WORKER_URL not configured" }
  }

  const res = await fetch(`${workerUrl}/internal/force-close-trades`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({
      user_id: args.userId,
      broker_account_id: args.brokerAccountId ?? null,
      channel_id: args.channelId ?? null,
      signal_id: args.signalId ?? null,
    }),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    return { ok: false, error: String(data.error ?? `Worker force close failed (${res.status})`) }
  }
  return data
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders })
  if (req.method !== "POST") return bad(405, "Method not allowed")

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? ""
    if (!token) return bad(401, "Unauthorized")
    const { data: authData, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authData.user) return bad(401, "Unauthorized")
    const userId = authData.user.id

    let body: { broker_account_id?: string; channel_id?: string | null; signal_id?: string | null }
    try {
      body = await req.json() as typeof body
    } catch {
      return bad(400, "Invalid JSON body")
    }

    const signalId = body.signal_id?.trim() || null
    if (signalId) {
      // Signal scope: close ONLY this signal's open positions, on every
      // broker account that holds them. broker_account_id is not required.
      const { data: signal, error: sigErr } = await supabase
        .from("signals")
        .select("id,user_id")
        .eq("id", signalId)
        .eq("user_id", userId)
        .maybeSingle()
      if (sigErr) {
        console.error("[force-close-trades] signal lookup failed:", sigErr.message)
        return bad(500, "Force close failed")
      }
      if (!signal) return bad(404, "Signal not found")

      const workerResult = await callWorkerForceClose({ userId, signalId })
      if (workerResult.error && workerResult.ok !== true) {
        console.error("[force-close-trades] worker error (signal scope):", String(workerResult.error))
        return bad(503, "Force close failed")
      }
      return Response.json(workerResult, { status: 200, headers: corsHeaders })
    }

    const brokerAccountId = body.broker_account_id?.trim()
    if (!brokerAccountId) return bad(400, "broker_account_id is required")

    const { data: broker, error: brokerErr } = await supabase
      .from("broker_accounts")
      .select(
        "id,provider,mtapi_session_id,fxsocket_account_id,metaapi_account_id,ctrader_account_id,binance_account_id,bybit_account_id,kucoin_account_id,dxtrade_account_id,tradelocker_account_id,matchtrader_account_id,provider_transition_state,signal_channel_ids",
      )
      .eq("id", brokerAccountId)
      .eq("user_id", userId)
      .maybeSingle()
    if (brokerErr) {
      console.error("[force-close-trades] broker lookup failed:", brokerErr.message)
      return bad(500, "Force close failed")
    }
    if (!broker) return bad(404, "Broker account not found")
    const provider = String(broker.provider ?? "fxsocket").trim() || "fxsocket"
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return bad(400, "Broker provider is invalid")
    }
    if (String(broker.provider_transition_state ?? "stable") !== "stable") {
      return bad(409, "Broker provider transition is in progress")
    }
    if (!providerSessionId(broker as BrokerSessionRow)) {
      return bad(400, "Broker has no active provider session")
    }

    const channelId = body.channel_id?.trim() || null
    if (channelId) {
      const { data: channel, error: chErr } = await supabase
        .from("telegram_channels")
        .select("id")
        .eq("id", channelId)
        .eq("user_id", userId)
        .maybeSingle()
      if (chErr) {
        console.error("[force-close-trades] channel lookup failed:", chErr.message)
        return bad(500, "Force close failed")
      }
      if (!channel) return bad(404, "Channel not found")

      const linked = normalizeChannelIds(broker.signal_channel_ids)
      if (
        linked.length > 0
        && !linked.some(id => id.toLowerCase() === channelId.toLowerCase())
      ) {
        return bad(400, "Channel is not linked to this broker account")
      }
    }

    const workerResult = await callWorkerForceClose({
      userId,
      brokerAccountId,
      channelId,
    })
    if (workerResult.error && workerResult.ok !== true) {
      console.error("[force-close-trades] worker error (broker scope):", String(workerResult.error))
      return bad(503, "Force close failed")
    }

    return Response.json(workerResult, { status: 200, headers: corsHeaders })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[force-close-trades]", msg)
    return bad(500, "Force close failed")
  }
})
