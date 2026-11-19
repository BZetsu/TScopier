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

async function sendExpo(messages: ExpoMessage[]) {
  if (messages.length === 0) return { data: [] };
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
  return json;
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
  for (const chunk of chunks) {
    results.push(await sendExpo(chunk));
  }

  return Response.json(
    { ok: true, sent: messages.length, results },
    { headers: corsHeaders },
  );
});
