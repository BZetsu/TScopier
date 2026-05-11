import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { makeClientFromEnv, MetatraderApiError } from "../_shared/metatraderapi.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const PLATFORMS = new Set(["MT4", "MT5"])

function bad(status: number, msg: string) {
  return Response.json({ error: msg }, { status, headers: corsHeaders })
}

function inferBrokerLabel(server: string): string {
  const s = (server ?? "").trim()
  if (!s) return ""
  const lower = s.toLowerCase()
  const rules: [string, string][] = [
    ["icmarkets", "IC Markets"],
    ["exness", "Exness"],
    ["ftmo", "FTMO"],
    ["deriv", "Deriv"],
    ["eightcap", "Eightcap"],
    ["vpfx", "VPFX"],
    ["m4markets", "M4 Markets"],
    ["olympicmarkets", "Olympic Markets"],
    ["hfmarkets", "HFM"],
    ["fxdd", "FXDD"],
    ["vtmarkets", "VT Markets"],
    ["lmax", "LMAX"],
    ["robomarkets", "RoboMarkets"],
    ["trading.com", "Trading.com"],
    ["metaquotes", "MetaQuotes"],
    ["pepperstone", "Pepperstone"],
    ["oanda", "OANDA"],
    ["fxtm", "FXTM"],
    ["admiral", "Admirals"],
    ["tickmill", "Tickmill"],
    ["thinkmarkets", "ThinkMarkets"],
    ["vantage", "Vantage"],
  ]
  for (const [needle, label] of rules) {
    if (lower.includes(needle)) return label
  }
  const first = s.split(/[-_/]/)[0]?.trim() ?? ""
  if (first.length < 2) return s
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/**
 * Account lifecycle for MetatraderAPI. Trade execution is NOT here — it lives in the
 * worker process for minimum latency. This function only runs for the rare UI-driven
 * register / delete / refresh balance / check connection calls.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders })

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

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const action = String((body as Record<string, unknown>).action ?? "")
    if (!action) return bad(400, "action required")

    const client = makeClientFromEnv(Deno.env)

    if (action === "register") {
      const platform = String((body as Record<string, unknown>).platform ?? "MT5").toUpperCase()
      if (!PLATFORMS.has(platform)) return bad(400, "platform must be MT4 or MT5")
      const server = String((body as Record<string, unknown>).server ?? "").trim()
      const login = String((body as Record<string, unknown>).login ?? "").trim()
      const password = String((body as Record<string, unknown>).password ?? "")
      const label = String((body as Record<string, unknown>).label ?? "").trim()
      const channelIds = Array.isArray((body as Record<string, unknown>).signal_channel_ids)
        ? ((body as Record<string, unknown>).signal_channel_ids as unknown[]).map(String)
        : []

      if (!server) return bad(400, "server required")
      if (!login) return bad(400, "login required")
      if (!password) return bad(400, "password required")

      const brokerName = inferBrokerLabel(server)
      const displayLabel = label || `${platform} • ${login}`
      const reg = await client.registerAccount({
        platform: platform as "MT4" | "MT5",
        server,
        login,
        password,
        name: displayLabel,
      })
      const uuid = reg.id
      if (!uuid) return bad(502, "MetatraderAPI did not return an account id")

      // Best-effort: pull balance immediately so the UI shows live numbers on first render.
      let summary: Awaited<ReturnType<typeof client.accountSummary>> | null = null
      try { summary = await client.accountSummary(uuid) } catch { summary = null }

      const insertPayload = {
        user_id: userId,
        label: displayLabel,
        platform,
        metaapi_account_id: uuid,
        broker_server: server,
        account_login: login,
        broker_name: brokerName,
        connection_status: "connected" as const,
        copier_mode: "ai" as const,
        signal_channel_ids: channelIds,
        enforce_signal_channel_filter: false,
        ai_settings: {},
        manual_settings: {},
        default_lot_size: 0.01,
        pip_tolerance: 20,
        max_trades_per_zone: 1,
        is_active: true,
        last_balance: summary?.balance ?? null,
        last_equity: summary?.equity ?? null,
        last_currency: summary?.currency ?? null,
        last_synced_at: summary ? new Date().toISOString() : null,
      }

      const { data: row, error: insErr } = await supabase
        .from("broker_accounts")
        .insert(insertPayload)
        .select("*")
        .single()
      if (insErr) {
        // Roll back the MetatraderAPI side so we don't orphan accounts.
        try { await client.deleteAccount(uuid) } catch { /* swallow */ }
        return bad(500, insErr.message)
      }

      // Make sure the server we just used is remembered for the typeahead next time.
      try {
        await supabase
          .from("mt_servers")
          .upsert(
            {
              server_name: server,
              platform,
              source: "learned",
              broker_label: brokerName || null,
              is_active: true,
            },
            { onConflict: "server_name_normalized" },
          )
      } catch { /* non-fatal */ }

      return Response.json({ ok: true, broker: row, summary }, { headers: corsHeaders })
    }

    if (action === "delete") {
      const brokerId = String((body as Record<string, unknown>).broker_id ?? "")
      if (!brokerId) return bad(400, "broker_id required")

      const { data: broker } = await supabase
        .from("broker_accounts")
        .select("id,user_id,metaapi_account_id")
        .eq("id", brokerId)
        .eq("user_id", userId)
        .maybeSingle()
      if (!broker) return bad(404, "Broker account not found")

      const uuid = String(broker.metaapi_account_id ?? "").trim()
      if (uuid && !uuid.includes("|")) {
        try { await client.deleteAccount(uuid) } catch { /* swallow — proceed with DB delete */ }
      }

      const { error: delErr } = await supabase
        .from("broker_accounts")
        .delete()
        .eq("id", brokerId)
        .eq("user_id", userId)
      if (delErr) return bad(500, delErr.message)

      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    if (action === "summary") {
      const brokerId = String((body as Record<string, unknown>).broker_id ?? "")
      if (!brokerId) return bad(400, "broker_id required")
      const { data: broker } = await supabase
        .from("broker_accounts")
        .select("id,metaapi_account_id")
        .eq("id", brokerId)
        .eq("user_id", userId)
        .maybeSingle()
      if (!broker) return bad(404, "Broker account not found")
      const uuid = String(broker.metaapi_account_id ?? "").trim()
      if (!uuid || uuid.includes("|")) return bad(400, "Broker is not linked to MetatraderAPI yet")

      try {
        const summary = await client.accountSummary(uuid)
        await supabase
          .from("broker_accounts")
          .update({
            last_balance: summary?.balance ?? null,
            last_equity: summary?.equity ?? null,
            last_currency: summary?.currency ?? null,
            last_synced_at: new Date().toISOString(),
            connection_status: "connected",
          })
          .eq("id", brokerId)
          .eq("user_id", userId)
        return Response.json({ ok: true, summary }, { headers: corsHeaders })
      } catch (e) {
        await supabase
          .from("broker_accounts")
          .update({ connection_status: "error" })
          .eq("id", brokerId)
          .eq("user_id", userId)
        const status = e instanceof MetatraderApiError ? e.status : 502
        const msg = e instanceof Error ? e.message : "AccountSummary failed"
        return bad(status >= 400 && status < 600 ? status : 502, msg)
      }
    }

    if (action === "check") {
      const brokerId = String((body as Record<string, unknown>).broker_id ?? "")
      if (!brokerId) return bad(400, "broker_id required")
      const { data: broker } = await supabase
        .from("broker_accounts")
        .select("id,metaapi_account_id")
        .eq("id", brokerId)
        .eq("user_id", userId)
        .maybeSingle()
      if (!broker) return bad(404, "Broker account not found")
      const uuid = String(broker.metaapi_account_id ?? "").trim()
      if (!uuid || uuid.includes("|")) return bad(400, "Broker is not linked to MetatraderAPI yet")

      try {
        const result = await client.checkConnect(uuid)
        await supabase
          .from("broker_accounts")
          .update({ connection_status: "connected" })
          .eq("id", brokerId)
          .eq("user_id", userId)
        return Response.json({ ok: true, result }, { headers: corsHeaders })
      } catch (e) {
        await supabase
          .from("broker_accounts")
          .update({ connection_status: "error" })
          .eq("id", brokerId)
          .eq("user_id", userId)
        const status = e instanceof MetatraderApiError ? e.status : 502
        const msg = e instanceof Error ? e.message : "CheckConnect failed"
        return bad(status >= 400 && status < 600 ? status : 502, msg)
      }
    }

    return bad(400, `Unknown action: ${action}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    const status = e instanceof MetatraderApiError ? e.status : 500
    return Response.json({ error: msg }, { status, headers: corsHeaders })
  }
})
