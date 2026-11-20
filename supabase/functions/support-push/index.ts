/**
 * support-push — fan-out Expo push notifications to support agents.
 *
 * POST JSON:
 *   { event, title, body, data?: Record<string, unknown> }
 *
 * Auth: service_role Bearer (called from DB triggers via pg_net).
 * verify_jwt: false (Authorization checked manually).
 *
 * Recipients are filtered by support_agent_notification_prefs (missing row = all on).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

type PushPayload = {
  event?: string;
  title?: string;
  body?: string;
  excludeUserId?: string;
  data?: Record<string, unknown>;
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default";
  priority: "high";
  channelId: "support";
};

type PrefCategory =
  | "agent_request"
  | "assigned_chat"
  | "tickets"
  | "issues"
  | "suggestions"
  | "feedback";

type PrefRow = {
  user_id: string;
  available: boolean;
  agent_request: boolean;
  assigned_chat: boolean;
  tickets: boolean;
  issues: boolean;
  suggestions: boolean;
  feedback: boolean;
};

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function isAuthorized(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  // Same multi-key pattern as support-notify: the platform service role may
  // differ from the Vault key pg_net/cron actually send (ALERT_EVALUATOR_SERVICE_KEY).
  const accepted = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    Deno.env.get("ALERT_EVALUATOR_SERVICE_KEY") ?? "",
    Deno.env.get("SUPPORT_PUSH_SERVICE_KEY") ?? "",
  ];
  return accepted.some((key) => key.length > 0 && token === key);
}

function categoryForEvent(event: string | undefined): PrefCategory | null {
  switch (event) {
    case "chat_queued":
      return "agent_request";
    case "chat_message":
      return "assigned_chat";
    case "ticket_created":
    case "ticket_message":
      return "tickets";
    case "flag_issue":
      return "issues";
    case "flag_suggestion":
      return "suggestions";
    case "feedback":
      return "feedback";
    default:
      return null;
  }
}

function allowsCategory(
  prefs: PrefRow | undefined,
  category: PrefCategory | null,
): boolean {
  // Missing prefs row = available + all categories on.
  if (prefs && prefs.available === false) return false;
  // Unknown events keep previous behavior (notify everyone with a token).
  if (!category) return true;
  if (!prefs) return true;
  return Boolean(prefs[category]);
}

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

async function sendExpo(messages: ExpoMessage[]) {
  if (messages.length === 0) return { data: [] as ExpoTicket[] };
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json === "object" && json && "errors" in json
        ? JSON.stringify(json.errors)
        : `Expo push failed (${res.status})`,
    );
  }
  return json as { data?: ExpoTicket[] };
}

function collectDeadTokens(
  messages: ExpoMessage[],
  tickets: ExpoTicket[] | undefined,
): string[] {
  if (!tickets?.length) return [];
  const dead: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const errorCode = ticket?.details?.error;
    // Only drop tokens that are gone on the device. InvalidCredentials is a
    // project FCM/APNs misconfig and must not wipe every registered agent.
    if (ticket?.status === "error" && errorCode === "DeviceNotRegistered") {
      const token = messages[i]?.to;
      if (token) dead.push(token);
    }
  }
  return dead;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");
  const authHeader = req.headers.get("Authorization");
  if (!isAuthorized(authHeader)) {
    return bad(401, "Unauthorized");
  }

  let payload: PushPayload;
  try {
    payload = (await req.json()) as PushPayload;
  } catch {
    return bad(400, "Invalid JSON");
  }

  const title = (payload.title ?? "uni Support").trim() || "uni Support";
  const body = (payload.body ?? "New activity").trim() || "New activity";
  const event = payload.event ?? "support";
  const category = categoryForEvent(event);
  const data = {
    ...(payload.data ?? {}),
    event,
  };

  const callerKey = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const dbKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("ALERT_EVALUATOR_SERVICE_KEY") ||
    callerKey;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, dbKey);

  let tokenQuery = admin
    .from("support_agent_push_tokens")
    .select("expo_push_token, user_id");

  if (payload.excludeUserId) {
    tokenQuery = tokenQuery.neq("user_id", payload.excludeUserId);
  }

  const [{ data: tokens, error }, { data: prefRows, error: prefError }] =
    await Promise.all([
      tokenQuery,
      admin.from("support_agent_notification_prefs").select(
        "user_id, available, agent_request, assigned_chat, tickets, issues, suggestions, feedback",
      ),
    ]);

  if (error) return bad(500, error.message);
  if (prefError) return bad(500, prefError.message);

  const prefsByUser = new Map<string, PrefRow>();
  for (const row of (prefRows ?? []) as PrefRow[]) {
    prefsByUser.set(String(row.user_id), row);
  }

  const uniqueTokens: string[] = [];
  const seen = new Set<string>();
  for (const row of tokens ?? []) {
    const token = String(row.expo_push_token ?? "").trim();
    const userId = String(row.user_id ?? "");
    if (!token.startsWith("ExponentPushToken") || seen.has(token)) continue;
    if (!allowsCategory(prefsByUser.get(userId), category)) continue;
    seen.add(token);
    uniqueTokens.push(token);
  }

  const messages: ExpoMessage[] = uniqueTokens.map((to) => ({
    to,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
    channelId: "support",
  }));

  const chunks: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  const results = [];
  const deadTokens = new Set<string>();
  for (const chunk of chunks) {
    const result = await sendExpo(chunk);
    results.push(result);
    for (const token of collectDeadTokens(chunk, result.data)) {
      deadTokens.add(token);
    }
  }

  if (deadTokens.size > 0) {
    await admin
      .from("support_agent_push_tokens")
      .delete()
      .in("expo_push_token", [...deadTokens]);
  }

  return Response.json(
    {
      ok: true,
      event,
      category,
      sent: messages.length,
      pruned: deadTokens.size,
      results,
    },
    { headers: corsHeaders },
  );
});
