import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

function bad(status: number, msg: string) {
  return Response.json({ error: msg }, { status, headers: corsHeaders })
}

async function callWorkerRetrySignal(args: {
  userId: string
  signalId: string
}): Promise<{ ok: boolean; accepted?: boolean; reason?: string; error?: string }> {
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

  const res = await fetch(`${workerUrl}/internal/retry-signal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({
      user_id: args.userId,
      signal_id: args.signalId,
    }),
  })
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean
    accepted?: boolean
    reason?: string
    error?: string
  }
  if (!res.ok) {
    return { ok: false, error: data.error ?? `Worker retry failed (${res.status})` }
  }
  return {
    ok: data.ok === true,
    accepted: data.accepted,
    reason: data.reason,
    error: data.error,
  }
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

    let body: { signal_id?: string }
    try {
      body = await req.json() as typeof body
    } catch {
      return bad(400, "Invalid JSON body")
    }

    const signalId = body.signal_id?.trim()
    if (!signalId) return bad(400, "signal_id is required")

    const workerResult = await callWorkerRetrySignal({ userId, signalId })
    if (workerResult.error) {
      return bad(503, workerResult.error)
    }
    return Response.json(
      {
        ok: workerResult.ok,
        accepted: workerResult.accepted,
        reason: workerResult.reason,
      },
      { status: 200, headers: corsHeaders },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[retry-signal]", msg)
    return bad(500, msg)
  }
})
