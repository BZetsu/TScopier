/**
 * broker-session-keepalive — cron backup when the Railway worker is down or overloaded.
 * Pings MT sessions and hard-reconnects using stored credentials.
 */

// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import {
  keepBrokerSessionAlive,
  makeMtClient,
  parseBrokerSessionId,
  reconnectBrokerSession,
} from "../_shared/brokerSession.ts"
import { isMtApiAuthConfigured, MetatraderApiError } from "../_shared/metatraderapi.ts"

// @ts-ignore Deno globals
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const MAX_BROKERS = Math.min(200, Math.max(10, Number(Deno.env.get("BROKER_KEEPALIVE_MAX_BROKERS") ?? 80) || 80))

Deno.serve(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), { status: 500 })
  }

  try {
    if (!isMtApiAuthConfigured(Deno.env)) {
      throw new MetatraderApiError("MT API is not configured on the server", 503)
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "MT API not configured" }),
      { status: 503 },
    )
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data, error } = await supabase
    .from("broker_accounts")
    .select(
      "id,user_id,metaapi_account_id,platform,account_login,broker_server,connection_status,auto_reconnect_enabled,mt_password_encrypted,performance_baseline_balance",
    )
    .not("metaapi_account_id", "is", null)
    .limit(MAX_BROKERS)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let alive = 0
  let reconnected = 0
  let recovering = 0
  let skipped = 0

  for (const row of data ?? []) {
    const broker = row as Record<string, unknown>
    const uuid = parseBrokerSessionId(String(broker.metaapi_account_id ?? ""))
    if (!uuid) {
      skipped++
      continue
    }
    const platform = String(broker.platform ?? "MT5")
    const client = makeMtClient(Deno.env, platform)

    const ok = await keepBrokerSessionAlive(client, uuid)
    if (ok) {
      alive++
      if (broker.connection_status === "error" || broker.connection_status === "recovering") {
        await supabase
          .from("broker_accounts")
          .update({
            connection_status: "connected",
            connection_error_kind: null,
            connection_error_message: null,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", broker.id)
      }
      continue
    }

    if (!broker.auto_reconnect_enabled || !broker.mt_password_encrypted) {
      skipped++
      continue
    }

    recovering++
    await supabase
      .from("broker_accounts")
      .update({ connection_status: "recovering", connection_error_kind: null, connection_error_message: null })
      .eq("id", broker.id)

    const result = await reconnectBrokerSession(client, supabase, broker as never, { env: Deno.env })
    if (result.connection_status === "connected") {
      reconnected++
    }
  }

  return new Response(
    JSON.stringify({
      brokers: (data ?? []).length,
      alive,
      reconnected,
      recovering_attempts: recovering,
      skipped,
    }),
    { headers: { "Content-Type": "application/json" } },
  )
})
