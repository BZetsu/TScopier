/**
 * support-translate — ensure a cached OpenAI translation for a support message.
 *
 * POST { action: "ensure", channel: "chat"|"ticket", message_id, target_locale,
 *        guest_token? }
 *
 * verify_jwt must be false so guests can call with guest_token.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeSupportLocale } from "../_shared/supportLocales.ts";
import { ensureMessageTranslation } from "../_shared/supportTranslate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

async function isSupportAgent(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles")
    .select("is_support_agent, is_admin, admin_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return false;
  if (profile.is_support_agent === true) return true;
  if (profile.is_admin === true) return true;
  if (profile.admin_until) {
    const until = new Date(String(profile.admin_until)).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}

async function authorizeChatMessage(
  admin: SupabaseClient,
  messageId: string,
  userId: string | null,
  guestToken: string | null,
): Promise<boolean> {
  const { data: msg } = await admin
    .from("support_messages")
    .select("id, conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return false;

  const { data: convo } = await admin
    .from("support_conversations")
    .select("user_id, guest_token")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!convo) return false;

  if (userId) {
    if (await isSupportAgent(admin, userId)) return true;
    return convo.user_id === userId;
  }
  return Boolean(guestToken && convo.guest_token === guestToken);
}

async function authorizeTicketMessage(
  admin: SupabaseClient,
  messageId: string,
  userId: string | null,
  guestToken: string | null,
): Promise<boolean> {
  const { data: msg } = await admin
    .from("support_ticket_messages")
    .select("id, ticket_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return false;

  const { data: ticket } = await admin
    .from("support_tickets")
    .select("user_id, guest_token")
    .eq("id", msg.ticket_id)
    .maybeSingle();
  if (!ticket) return false;

  if (userId) {
    if (await isSupportAgent(admin, userId)) return true;
    return ticket.user_id === userId;
  }
  return Boolean(guestToken && ticket.guest_token === guestToken);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return bad(500, "Server misconfigured");

  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad(400, "Invalid JSON");
  }

  const action = String(body.action ?? "ensure");
  if (action !== "ensure") return bad(400, "Unknown action");

  const channel = String(body.channel ?? "").trim();
  if (channel !== "chat" && channel !== "ticket") {
    return bad(400, "channel must be chat or ticket");
  }

  const messageId = String(body.message_id ?? "").trim();
  if (!messageId) return bad(400, "message_id required");

  const targetLocale = normalizeSupportLocale(String(body.target_locale ?? "en"));
  const guestToken = String(body.guest_token ?? "").trim() || null;

  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let userId: string | null = null;
  if (bearer) {
    const { data: authData } = await admin.auth.getUser(bearer);
    if (authData.user) userId = authData.user.id;
  }

  if (!userId && !guestToken) {
    return bad(401, "Sign in or provide guest_token");
  }

  const allowed =
    channel === "chat"
      ? await authorizeChatMessage(admin, messageId, userId, guestToken)
      : await authorizeTicketMessage(admin, messageId, userId, guestToken);

  if (!allowed) return bad(403, "Not allowed");

  try {
    const result = await ensureMessageTranslation(admin, {
      channel,
      messageId,
      targetLocale,
    });
    return Response.json(result, { headers: corsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed";
    console.error("support-translate error", message);
    return bad(500, message);
  }
});
