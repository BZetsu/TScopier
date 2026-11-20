/**
 * support-push — fan-out Expo push notifications to support agents.
 *
 * POST JSON:
 *   { event, title, body, data?: Record<string, unknown> }
 *
 * Auth: service_role Bearer (called from DB triggers via pg_net).
 * verify_jwt: false (Authorization checked manually).
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

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function isServiceRole(authHeader: string | null): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || !authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === serviceKey;
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
  if (!isServiceRole(req.headers.get("Authorization"))) {
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
  const data = {
    ...(payload.data ?? {}),
    event: payload.event ?? "support",
  };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let tokenQuery = admin
    .from("support_agent_push_tokens")
    .select("expo_push_token, user_id");

  if (payload.excludeUserId) {
    tokenQuery = tokenQuery.neq("user_id", payload.excludeUserId);
  }

  const { data: tokens, error } = await tokenQuery;

  if (error) return bad(500, error.message);

  const unique = [
    ...new Set(
      (tokens ?? [])
        .map((row) => String(row.expo_push_token ?? "").trim())
        .filter((t) => t.startsWith("ExponentPushToken")),
    ),
  ];

  const messages: ExpoMessage[] = unique.map((to) => ({
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
      sent: messages.length,
      pruned: deadTokens.size,
      results,
    },
    { headers: corsHeaders },
  );
});
