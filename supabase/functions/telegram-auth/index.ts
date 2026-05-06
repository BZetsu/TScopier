import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { TelegramClient } from "npm:telegram@2"
import { StringSession } from "npm:telegram/sessions/index.js"
import { Api } from "npm:telegram/tl/index.js"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const API_ID = parseInt(Deno.env.get("TELEGRAM_API_ID") ?? "0")
const API_HASH = Deno.env.get("TELEGRAM_API_HASH") ?? ""

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

    const body = await req.json()
    const { action } = body

    if (action === "send_code") {
      const { phone } = body
      if (!phone) {
        return Response.json({ error: "Phone number required" }, { status: 400, headers: corsHeaders })
      }

      const session = new StringSession("")
      const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 3 })
      await client.connect()

      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: API_ID,
          apiHash: API_HASH,
          settings: new Api.CodeSettings({}),
        })
      )

      // Save session string so verify_code can reuse the same DC connection
      const sessionString = client.session.save() as unknown as string
      await client.disconnect()

      return Response.json(
        { phone_code_hash: result.phoneCodeHash, session_string: sessionString },
        { headers: corsHeaders }
      )
    }

    if (action === "verify_code") {
      const { phone, code, phone_code_hash, session_string: savedSession, password } = body
      if (!phone || !code || !phone_code_hash) {
        return Response.json({ error: "Phone, code, and phone_code_hash required" }, { status: 400, headers: corsHeaders })
      }

      // Reuse the session from send_code to stay on the same DC — prevents PHONE_CODE_EXPIRED
      const session = new StringSession(savedSession ?? "")
      const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 3 })
      await client.connect()

      try {
        if (password) {
          // Second pass: 2FA password provided — sign in with code first, then handle the SRP check
          try {
            await client.invoke(
              new Api.auth.SignIn({
                phoneNumber: phone,
                phoneCodeHash: phone_code_hash,
                phoneCode: code,
              })
            )
          } catch (signInErr: unknown) {
            const msg = signInErr instanceof Error ? signInErr.message : String(signInErr)
            if (!msg.includes("SESSION_PASSWORD_NEEDED")) throw signInErr
          }
          const srpResult = await client.invoke(new Api.account.GetPassword({}))
          const { computeCheck } = await import("npm:telegram/Password.js")
          const srpCheck = await computeCheck(srpResult, password)
          await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }))
        } else {
          await client.invoke(
            new Api.auth.SignIn({
              phoneNumber: phone,
              phoneCodeHash: phone_code_hash,
              phoneCode: code,
            })
          )
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (errorMessage.includes("SESSION_PASSWORD_NEEDED")) {
          await client.disconnect()
          return Response.json({ error: "Two-step verification required", requires_password: true }, { status: 400, headers: corsHeaders })
        }
        await client.disconnect()
        return Response.json({ error: errorMessage }, { status: 400, headers: corsHeaders })
      }

      const sessionString = client.session.save() as unknown as string
      await client.disconnect()

      return Response.json({ session_string: sessionString }, { headers: corsHeaders })
    }

    if (action === "list_channels") {
      // Load user's session from DB
      const { data: sessionRow } = await supabase
        .from("telegram_sessions")
        .select("session_string")
        .eq("user_id", user.id)
        .maybeSingle()

      if (!sessionRow?.session_string) {
        return Response.json({ error: "No Telegram session found" }, { status: 400, headers: corsHeaders })
      }

      const session = new StringSession(sessionRow.session_string)
      const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 3 })
      await client.connect()

      const dialogs = await client.getDialogs({ limit: 100 })
      const channels = dialogs
        .filter(d => d.isChannel || d.isGroup)
        .map(d => ({
          id: String(d.id),
          title: d.title ?? "Unknown",
          username: (d.entity as { username?: string })?.username ?? "",
          members_count: (d.entity as { participantsCount?: number })?.participantsCount ?? 0,
        }))
        .filter(c => c.id)

      await client.disconnect()

      return Response.json({ channels }, { headers: corsHeaders })
    }

    return Response.json({ error: "Unknown action" }, { status: 400, headers: corsHeaders })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("telegram-auth error:", message)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
