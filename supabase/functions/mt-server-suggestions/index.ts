import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
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

    const url = new URL(req.url)
    const q = (url.searchParams.get("q") ?? "").trim()
    const platform = (url.searchParams.get("platform") ?? "MT5").toUpperCase()

    let query = supabase
      .from("mt_servers")
      .select("server_name, platform")
      .eq("is_active", true)
      .or(`platform.eq.${platform},platform.eq.ANY`)
      .order("server_name", { ascending: true })
      .limit(20)

    if (q) {
      query = query.ilike("server_name", `%${q}%`)
    }

    const { data, error } = await query
    if (error) {
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })
    }

    const suggestions = (data ?? []).map(row => row.server_name)
    return Response.json({ suggestions }, { headers: corsHeaders })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("mt-server-suggestions error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
