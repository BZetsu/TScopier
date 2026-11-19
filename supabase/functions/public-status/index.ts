/**
 * Public platform status (unauthenticated).
 * Sanitized view of system_probe_state + firing alert_events for /status.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import {
  PUBLIC_PROBE_TARGETS,
  buildPublicStatus,
  type FiringAlertRow,
  type ProbeRow,
} from "../_shared/publicStatus.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "public, max-age=30",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  if (!supabaseUrl || !serviceKey) {
    return Response.json(
      { error: "Status service unavailable" },
      { status: 503, headers: corsHeaders },
    )
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const probesRes = await sb
    .from("system_probe_state")
    .select("target, state, updated_at")
    .in("target", [...PUBLIC_PROBE_TARGETS])

  const apiOk = !probesRes.error
  const probes = (probesRes.data ?? []) as ProbeRow[]

  let firingAlerts: FiringAlertRow[] = []
  if (apiOk) {
    const alertsRes = await sb
      .from("alert_events")
      .select("id, rule_code, severity, created_at")
      .eq("state", "firing")
      .order("created_at", { ascending: false })
      .limit(40)
    if (!alertsRes.error && alertsRes.data) {
      firingAlerts = alertsRes.data as FiringAlertRow[]
    }
  }

  const payload = buildPublicStatus({
    probes,
    firingAlerts,
    apiOk,
  })

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
