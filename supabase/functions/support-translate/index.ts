/**
 * support-translate — ensure a cached OpenAI translation for a support message.
 *
 * POST { action: "ensure", channel: "chat"|"ticket", message_id, target_locale,
 *        guest_token? }
 * POST { action: "repair_source_locale", channel: "chat"|"ticket",
 *        conversation_id|ticket_id|message_ids, target_locale? }
 *
 * verify_jwt must be false so guests can call ensure with guest_token.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isAdminAccessActive } from "../_shared/adminAccess.ts";
import { normalizeSupportLocale } from "../_shared/supportLocales.ts";
import { ensureMessageTranslation } from "../_shared/supportTranslate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};
const MAX_REPAIR_MESSAGES = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function requireUuid(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!UUID_PATTERN.test(text)) return "";
  return text;
}

async function repairMessageIds(
  admin: SupabaseClient,
  channel: "chat" | "ticket",
  body: Record<string, unknown>,
): Promise<string[]> {
  const explicit = Array.isArray(body.message_ids)
    ? body.message_ids.map((value) => String(value ?? "").trim())
    : [];
  if (explicit.length > MAX_REPAIR_MESSAGES) {
    throw new Error(`message_ids cannot contain more than ${MAX_REPAIR_MESSAGES} entries`);
  }
  if (explicit.length) {
    const ids = [...new Set(explicit)];
    if (ids.some((id) => !UUID_PATTERN.test(id))) {
      throw new Error("message_ids must contain UUIDs");
    }
    return ids;
  }

  const single = String(body.message_id ?? "").trim();
  if (single) {
    if (!UUID_PATTERN.test(single)) throw new Error("message_id must be a UUID");
    return [single];
  }

  const parentField = channel === "chat" ? "conversation_id" : "ticket_id";
  const parentId = requireUuid(body[parentField]);
  if (!parentId) throw new Error(`${parentField} must be a UUID`);

  const table = channel === "chat" ? "support_messages" : "support_ticket_messages";
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq(parentField, parentId)
    .order("created_at", { ascending: true })
    .limit(MAX_REPAIR_MESSAGES + 1);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => String(row.id));
  if (ids.length > MAX_REPAIR_MESSAGES) {
    throw new Error(
      `This ${channel === "chat" ? "conversation" : "ticket"} has more than ${MAX_REPAIR_MESSAGES} messages; repair a bounded message_ids list instead`,
    );
  }
  return ids;
}

async function isSupportAgent(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles")
    .select("is_support_agent, is_admin, admin_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return false;
  if (profile.is_support_agent === true) return true;
  return isAdminAccessActive(profile);
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
  if (action !== "ensure" && action !== "repair_source_locale") {
    return bad(400, "Unknown action");
  }

  const channel = String(body.channel ?? "").trim();
  if (channel !== "chat" && channel !== "ticket") {
    return bad(400, "channel must be chat or ticket");
  }

  const targetLocale = normalizeSupportLocale(String(body.target_locale ?? "en"));
  const guestToken = String(body.guest_token ?? "").trim() || null;

  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let userId: string | null = null;
  if (bearer) {
    const { data: authData } = await admin.auth.getUser(bearer);
    if (authData.user) userId = authData.user.id;
  }

  if (action === "repair_source_locale") {
    if (!userId || !(await isSupportAgent(admin, userId))) {
      return bad(403, "Support agent access required");
    }

    try {
      const messageIds = await repairMessageIds(admin, channel, body);
      if (!messageIds.length) {
        return Response.json(
          { ok: true, inspected: 0, results: [], failures: [] },
          { headers: corsHeaders },
        );
      }

      const results: Array<{
        message_id: string;
        source_locale: string;
        translated: boolean;
        source_repaired: boolean;
        translation_cached: boolean;
        cache_saved: boolean;
      }> = [];
      const failures: Array<{ message_id: string; error: string }> = [];
      for (const id of messageIds) {
        try {
          const result = await ensureMessageTranslation(admin, {
            channel,
            messageId: id,
            targetLocale,
            repairSourceLocale: true,
          });
          results.push({
            message_id: id,
            source_locale: result.source_locale,
            translated: result.translated,
            source_repaired: result.source_repaired,
            translation_cached: result.translated,
            cache_saved: result.cache_saved,
          });
        } catch (err) {
          failures.push({
            message_id: id,
            error: err instanceof Error ? err.message : "Translation failed",
          });
        }
      }

      return Response.json(
        {
          ok: failures.length === 0,
          inspected: messageIds.length,
          results,
          failures,
        },
        { headers: corsHeaders },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Translation repair failed";
      console.error("support-translate repair error", message);
      return bad(400, message);
    }
  }

  const messageId = String(body.message_id ?? "").trim();
  if (!messageId) return bad(400, "message_id required");

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
