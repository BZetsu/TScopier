import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const METATRADERAPI_BASE_URL = (Deno.env.get("METATRADERAPI_BASE_URL") ?? "https://api.metatraderapi.dev").replace(/\/$/, "")
const METATRADERAPI_KEY = Deno.env.get("METATRADERAPI_KEY") ?? ""

interface BrokerServer {
  value: string
  label: string
  icon_url: string | null
}

function normalizeList(payload: unknown): BrokerServer[] {
  const list = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
      ? (payload as Record<string, unknown>).data as unknown[]
      : []

  const out: BrokerServer[] = []
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ value: item, label: item, icon_url: null })
      continue
    }
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const server =
      (row.server as string | undefined) ??
      (row.serverName as string | undefined) ??
      (row.name as string | undefined) ??
      ""
    if (!server) continue
    const brokerName = (row.broker as string | undefined) ?? (row.brokerName as string | undefined) ?? ""
    const icon = (row.icon as string | undefined) ?? (row.logo as string | undefined) ?? null
    out.push({
      value: server,
      label: brokerName ? `${brokerName} - ${server}` : server,
      icon_url: icon,
    })
  }
  return out
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

    if (!METATRADERAPI_KEY) {
      return Response.json({ error: "METATRADERAPI_KEY is not configured" }, { status: 503, headers: corsHeaders })
    }

    const platform = new URL(req.url).searchParams.get("platform")?.toUpperCase() ?? "MT5"

    const candidates = [
      `/Brokers?platform=${encodeURIComponent(platform)}`,
      `/GetBrokers?platform=${encodeURIComponent(platform)}`,
      `/Servers?platform=${encodeURIComponent(platform)}`,
      `/GetServers?platform=${encodeURIComponent(platform)}`,
      "/Brokers",
      "/GetBrokers",
      "/Servers",
      "/GetServers",
    ]

    for (const path of candidates) {
      const res = await fetch(`${METATRADERAPI_BASE_URL}${path}`, {
        method: "GET",
        headers: {
          "x-api-key": METATRADERAPI_KEY,
        },
      })
      if (!res.ok) continue
      const raw = await res.text()
      let payload: unknown = null
      try { payload = JSON.parse(raw) } catch { payload = raw }
      const brokers = normalizeList(payload)
      if (brokers.length > 0) {
        return Response.json({ brokers }, { headers: corsHeaders })
      }
    }

    // Fallback empty list so UI can allow manual server input.
    return Response.json({ brokers: [] }, { headers: corsHeaders })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("metatrader-brokers error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
