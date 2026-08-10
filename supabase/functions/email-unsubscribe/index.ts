import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { createHmac, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("VITE_APP_URL") || "https://app.tscopier.ai").replace(/\/$/, "");
const UNSUBSCRIBE_PAGE_URL = (
  Deno.env.get("EMAIL_UNSUBSCRIBE_PAGE_URL")
  || `${APP_URL}/unsubscribe.html`
).replace(/\?.*$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function verifyToken(userId: string, token: string): boolean {
  const hmac = createHmac("sha256", SUPABASE_SERVICE_ROLE_KEY);
  hmac.update(userId);
  const expected = hmac.digest("hex");
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(token, "utf-8"),
      Buffer.from(expected, "utf-8"),
    );
  } catch {
    return false;
  }
}

function appUnsubscribeUrl(uid: string, token: string, extra?: Record<string, string>): string {
  const u = new URL(UNSUBSCRIBE_PAGE_URL);
  u.searchParams.set("uid", uid);
  u.searchParams.set("token", token);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  }
  return u.toString();
}

async function lookupUnsubscribed(uid: string): Promise<boolean> {
  const { data } = await supabase
    .from("email_unsubscribes")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();
  return Boolean(data);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const wantsJson =
      url.searchParams.get("format") === "json"
      || (req.headers.get("accept") ?? "").includes("application/json");

    if (req.method === "GET") {
      const uid = url.searchParams.get("uid");
      const token = url.searchParams.get("token");

      if (!uid || !token) {
        if (wantsJson) return json({ ok: false, error: "missing_params" }, 400);
        return Response.redirect(`${UNSUBSCRIBE_PAGE_URL}?error=invalid`, 302);
      }

      if (!verifyToken(uid, token)) {
        if (wantsJson) return json({ ok: false, error: "invalid_token" }, 403);
        return Response.redirect(appUnsubscribeUrl(uid, token, { error: "expired" }), 302);
      }

      const already = await lookupUnsubscribed(uid);
      if (wantsJson) {
        return json({ ok: true, already_unsubscribed: already });
      }

      // Supabase rewrites text/html → text/plain on GET. Serve the UI on the app host instead.
      return Response.redirect(
        appUnsubscribeUrl(uid, token, already ? { status: "already" } : undefined),
        302,
      );
    }

    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";
      let uid: string | null = null;
      let token: string | null = null;
      let reason: string | null = null;

      if (contentType.includes("application/json")) {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        uid = typeof body.uid === "string" ? body.uid : null;
        token = typeof body.token === "string" ? body.token : null;
        reason = typeof body.reason === "string" ? body.reason : null;
      } else {
        const formData = await req.formData();
        uid = formData.get("uid")?.toString() ?? null;
        token = formData.get("token")?.toString() ?? null;
        reason = formData.get("reason")?.toString() ?? null;
      }

      if (!uid || !token) {
        if (wantsJson || contentType.includes("application/json")) {
          return json({ ok: false, error: "missing_params" }, 400);
        }
        return Response.redirect(`${UNSUBSCRIBE_PAGE_URL}?error=invalid`, 302);
      }

      if (!verifyToken(uid, token)) {
        if (wantsJson || contentType.includes("application/json")) {
          return json({ ok: false, error: "invalid_token" }, 403);
        }
        return Response.redirect(appUnsubscribeUrl(uid, token, { error: "expired" }), 302);
      }

      const { error } = await supabase
        .from("email_unsubscribes")
        .upsert(
          {
            user_id: uid,
            unsubscribed_at: new Date().toISOString(),
            reason,
          },
          { onConflict: "user_id" },
        );

      if (error) {
        console.error("[email-unsubscribe] upsert error:", error.message);
        if (wantsJson || contentType.includes("application/json")) {
          return json({ ok: false, error: "server_error" }, 500);
        }
        return Response.redirect(appUnsubscribeUrl(uid, token, { error: "server" }), 302);
      }

      if (wantsJson || contentType.includes("application/json")) {
        return json({ ok: true });
      }
      return Response.redirect(appUnsubscribeUrl(uid, token, { status: "success" }), 302);
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (err) {
    console.error("[email-unsubscribe] unexpected error:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
