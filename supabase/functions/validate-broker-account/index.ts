import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const METATRADERAPI_BASE_URL = (Deno.env.get("METATRADERAPI_BASE_URL") ?? "https://api.metatraderapi.dev").replace(/\/$/, "")
const METATRADERAPI_KEY = Deno.env.get("METATRADERAPI_KEY") ?? ""

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
      return Response.json(
        { error: "Metatrader API key is not configured." },
        { status: 503, headers: corsHeaders },
      )
    }

    const body = await req.json().catch(() => ({})) as { account_id?: string; platform?: string }
    const accountId = (body.account_id ?? "").trim()
    const platform = (body.platform ?? "").trim().toUpperCase()

    if (!accountId) {
      return Response.json({ error: "account_id is required" }, { status: 400, headers: corsHeaders })
    }

    if (platform !== "MT4" && platform !== "MT5") {
      return Response.json({ error: "Only MT4/MT5 can be validated" }, { status: 400, headers: corsHeaders })
    }

    const checkRes = await fetch(
      `${METATRADERAPI_BASE_URL}/CheckConnect?id=${encodeURIComponent(accountId)}`,
      {
        method: "GET",
        headers: {
          "x-api-key": METATRADERAPI_KEY,
        },
      },
    )

    const raw = await checkRes.text()
    if (!checkRes.ok) {
      return Response.json(
        {
          ok: false,
          error: `MetatraderApi validation failed (${checkRes.status})`,
          detail: raw,
        },
        { status: 400, headers: corsHeaders },
      )
    }

    return Response.json(
      {
        ok: true,
        account_id: accountId,
        platform,
        message: raw || "Connected",
      },
      { headers: corsHeaders },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("validate-broker-account error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
