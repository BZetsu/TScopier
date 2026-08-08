/**
 * assistant-chat — JWT-authenticated OpenAI tool-calling assistant for in-app help + actions.
 *
 * POST body:
 *   { messages: [{ role, content, images?: dataUrl[] }], locale?: string }
 *   OR { execute: { tool: string, args: Record<string, unknown> } }  // confirmed mutations
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  ASSISTANT_SYSTEM_PROMPT,
  FEATURE_TOPICS,
} from "../_shared/assistantKnowledge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("ASSISTANT_OPENAI_MODEL")?.trim() || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 4;
const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGE_DATA_URL_CHARS = 1_400_000;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: string
  content: string | null | ContentPart[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
}
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type PendingClientAction = {
  type: string;
  summary: string;
  args?: Record<string, unknown>;
};

type PendingConfirmation = {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
};

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const NAV_ALLOWLIST = new Set([
  "/dashboard",
  "/copier-engine",
  "/account-config",
  "/channels",
  "/billing",
  "/contact-support",
  "/pricing",
]);

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_setup_status",
      description: "Get Telegram link status, brokers, channels count, and copier pause state.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_copier_paused",
      description:
        "Pause or resume the copier. Call first without confirmed; UI will confirm, then client re-executes with confirmed=true.",
      parameters: {
        type: "object",
        properties: {
          paused: { type: "boolean" },
          confirmed: { type: "boolean" },
        },
        required: ["paused"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_brokers",
      description: "List the user's broker accounts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_channels",
      description: "List active Telegram channels for the user.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_presets",
      description: "List saved trading presets.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_preset",
      description:
        "Apply a preset to a channel on a broker. Requires broker_account_id, channel_id, and preset_id or preset_name. Use confirmed only after UI confirm.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          channel_id: { type: "string" },
          preset_id: { type: "string" },
          preset_name: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["broker_account_id", "channel_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_preset",
      description:
        "Save current channel config on a broker as a named preset. Use confirmed after UI confirm.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          channel_id: { type: "string" },
          name: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["broker_account_id", "channel_id", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_feature",
      description: "Return a canned deep explanation for a product topic.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: Object.keys(FEATURE_TOPICS),
          },
        },
        required: ["topic"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_connect_broker",
      description: "Open the connect MT4/MT5 broker modal in the app UI.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_telegram_link",
      description: "Open Copier Engine so the user can link Telegram.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the app to an allowlisted path.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "One of: /dashboard /copier-engine /account-config /channels /billing /contact-support /pricing",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_live_chat",
      description: "Open human live chat support.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_config_change",
      description:
        "Propose a configuration change for the user to review in the UI (does not save by itself).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          broker_account_id: { type: "string" },
          channel_id: { type: "string" },
          hint: { type: "string", description: "What to change in plain language" },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
] as const;

type ToolResult = {
  content: string;
  pendingClientAction?: PendingClientAction;
  pendingConfirmation?: PendingConfirmation;
};

async function toolGetSetupStatus(supabase: SupabaseClient, userId: string): Promise<ToolResult> {
  const [{ data: session }, { data: profile }, { data: brokers }, { data: channels }, { data: sub }] =
    await Promise.all([
      supabase.from("telegram_sessions").select("user_id,session_string").eq("user_id", userId).maybeSingle(),
      supabase.from("user_profiles").select("copier_paused,display_name").eq("user_id", userId).maybeSingle(),
      supabase
        .from("broker_accounts")
        .select("id,name,broker_name,platform,is_active,fxsocket_account_id")
        .eq("user_id", userId),
      supabase
        .from("telegram_channels")
        .select("id,display_name,channel_username,is_active")
        .eq("user_id", userId)
        .eq("is_active", true),
      supabase.from("subscriptions").select("plan,status").eq("user_id", userId).maybeSingle(),
    ]);

  const telegramLinked = Boolean(session?.session_string && String(session.session_string).length > 0);
  const brokerList = brokers ?? [];
  const connected = brokerList.filter((b) => b.is_active && b.fxsocket_account_id).length;

  return {
    content: JSON.stringify({
      telegram_linked: telegramLinked,
      copier_paused: profile?.copier_paused === true,
      display_name: profile?.display_name ?? null,
      brokers_total: brokerList.length,
      brokers_connected: connected,
      channels_active: (channels ?? []).length,
      subscription: sub ?? null,
    }),
  };
}

async function toolListBrokers(supabase: SupabaseClient, userId: string): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("broker_accounts")
    .select("id,name,broker_name,platform,is_active,fxsocket_account_id,server")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return {
    content: JSON.stringify({
      brokers: (data ?? []).map((b) => ({
        id: b.id,
        name: b.name || b.broker_name,
        platform: b.platform,
        is_active: b.is_active,
        connected: Boolean(b.fxsocket_account_id),
        server: b.server,
      })),
    }),
  };
}

async function toolListChannels(supabase: SupabaseClient, userId: string): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("telegram_channels")
    .select("id,display_name,channel_username,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("display_name");
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return { content: JSON.stringify({ channels: data ?? [] }) };
}

async function toolListPresets(supabase: SupabaseClient, userId: string): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("channel_trading_presets")
    .select("id,name,copier_mode,updated_at")
    .eq("user_id", userId)
    .order("name");
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return { content: JSON.stringify({ presets: data ?? [] }) };
}

async function toolSetCopierPaused(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const paused = Boolean(args.paused);
  const confirmed = args.confirmed === true;
  if (!confirmed) {
    return {
      content: JSON.stringify({ needs_confirmation: true, paused }),
      pendingConfirmation: {
        tool: "set_copier_paused",
        args: { paused },
        summary: paused ? "Pause the copier?" : "Resume the copier?",
      },
    };
  }
  const { error } = await supabase
    .from("user_profiles")
    .update({ copier_paused: paused, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return { content: JSON.stringify({ ok: true, copier_paused: paused }) };
}

async function loadPreset(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
) {
  const presetId = String(args.preset_id ?? "").trim();
  const presetName = String(args.preset_name ?? "").trim();
  let q = supabase
    .from("channel_trading_presets")
    .select("id,name,copier_mode,manual_settings,channel_filters")
    .eq("user_id", userId);
  if (presetId) q = q.eq("id", presetId);
  else if (presetName) q = q.eq("name", presetName);
  else return { error: "preset_id or preset_name required" };
  const { data, error } = await q.maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Preset not found" };
  return { preset: data };
}

async function toolApplyPreset(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const brokerId = String(args.broker_account_id ?? "").trim();
  const channelId = String(args.channel_id ?? "").trim();
  if (!brokerId || !channelId) {
    return { content: JSON.stringify({ error: "broker_account_id and channel_id required" }) };
  }
  const loaded = await loadPreset(supabase, userId, args);
  if ("error" in loaded && loaded.error) {
    return { content: JSON.stringify({ error: loaded.error }) };
  }
  const preset = loaded.preset!;
  if (args.confirmed !== true) {
    return {
      content: JSON.stringify({ needs_confirmation: true, preset: preset.name }),
      pendingConfirmation: {
        tool: "apply_preset",
        args: {
          broker_account_id: brokerId,
          channel_id: channelId,
          preset_id: preset.id,
        },
        summary: `Apply preset "${preset.name}" to this channel?`,
      },
    };
  }

  const { data: broker, error: brokerErr } = await supabase
    .from("broker_accounts")
    .select("id,channel_trading_configs,channel_message_filters,signal_channel_ids")
    .eq("id", brokerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (brokerErr || !broker) {
    return { content: JSON.stringify({ error: brokerErr?.message ?? "Broker not found" }) };
  }

  const mode = preset.copier_mode === "ai" ? "ai" : "manual";
  const manual = (preset.manual_settings && typeof preset.manual_settings === "object"
    ? preset.manual_settings
    : {}) as Record<string, unknown>;
  const filters = (preset.channel_filters && typeof preset.channel_filters === "object"
    ? preset.channel_filters
    : {}) as Record<string, unknown>;

  const { error: upsertErr } = await supabase.from("broker_channel_trading_configs").upsert(
    {
      user_id: userId,
      broker_account_id: brokerId,
      channel_id: channelId,
      copier_mode: mode,
      manual_settings: {
        ...manual,
        allow_high_impact_news: manual.news_trading_enabled === true,
      },
      ai_settings: {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "broker_account_id,channel_id" },
  );
  if (upsertErr) return { content: JSON.stringify({ error: upsertErr.message }) };

  const configs =
    broker.channel_trading_configs && typeof broker.channel_trading_configs === "object"
      ? { ...(broker.channel_trading_configs as Record<string, unknown>) }
      : {};
  configs[channelId] = {
    copier_mode: mode,
    manual_settings: {
      ...manual,
      allow_high_impact_news: manual.news_trading_enabled === true,
    },
    ai_settings: {},
  };
  const msgFilters =
    broker.channel_message_filters && typeof broker.channel_message_filters === "object"
      ? { ...(broker.channel_message_filters as Record<string, unknown>) }
      : {};
  msgFilters[channelId] = filters;
  const signalIds = Array.isArray(broker.signal_channel_ids)
    ? [...broker.signal_channel_ids.map(String)]
    : [];
  if (!signalIds.includes(channelId)) signalIds.push(channelId);

  const { error: upErr } = await supabase
    .from("broker_accounts")
    .update({
      channel_trading_configs: configs,
      channel_message_filters: msgFilters,
      signal_channel_ids: signalIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", brokerId)
    .eq("user_id", userId);
  if (upErr) return { content: JSON.stringify({ error: upErr.message }) };

  return {
    content: JSON.stringify({ ok: true, preset: preset.name, broker_account_id: brokerId, channel_id: channelId }),
  };
}

async function toolSavePreset(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const brokerId = String(args.broker_account_id ?? "").trim();
  const channelId = String(args.channel_id ?? "").trim();
  const name = String(args.name ?? "").trim();
  if (!brokerId || !channelId || !name) {
    return { content: JSON.stringify({ error: "broker_account_id, channel_id, and name required" }) };
  }
  if (args.confirmed !== true) {
    return {
      content: JSON.stringify({ needs_confirmation: true, name }),
      pendingConfirmation: {
        tool: "save_preset",
        args: { broker_account_id: brokerId, channel_id: channelId, name },
        summary: `Save current channel settings as preset "${name}"?`,
      },
    };
  }

  const { data: row } = await supabase
    .from("broker_channel_trading_configs")
    .select("copier_mode,manual_settings")
    .eq("broker_account_id", brokerId)
    .eq("channel_id", channelId)
    .maybeSingle();

  const { data: broker } = await supabase
    .from("broker_accounts")
    .select("id,channel_trading_configs,channel_message_filters,user_id")
    .eq("id", brokerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!broker) return { content: JSON.stringify({ error: "Broker not found" }) };

  let mode = row?.copier_mode === "ai" ? "ai" : "manual";
  let manual = (row?.manual_settings && typeof row.manual_settings === "object"
    ? row.manual_settings
    : {}) as Record<string, unknown>;
  if (!row) {
    const map =
      broker.channel_trading_configs && typeof broker.channel_trading_configs === "object"
        ? (broker.channel_trading_configs as Record<string, unknown>)
        : {};
    const entry = map[channelId] as Record<string, unknown> | undefined;
    if (entry) {
      mode = entry.copier_mode === "ai" ? "ai" : "manual";
      manual = (entry.manual_settings && typeof entry.manual_settings === "object"
        ? entry.manual_settings
        : {}) as Record<string, unknown>;
    }
  }
  const filtersMap =
    broker.channel_message_filters && typeof broker.channel_message_filters === "object"
      ? (broker.channel_message_filters as Record<string, unknown>)
      : {};
  const filters = (filtersMap[channelId] && typeof filtersMap[channelId] === "object"
    ? filtersMap[channelId]
    : {}) as Record<string, unknown>;

  const { data: saved, error } = await supabase
    .from("channel_trading_presets")
    .upsert(
      {
        user_id: userId,
        name,
        copier_mode: mode,
        manual_settings: {
          ...manual,
          allow_high_impact_news: manual.news_trading_enabled === true,
        },
        channel_filters: filters,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,name" },
    )
    .select("id,name")
    .single();
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return { content: JSON.stringify({ ok: true, preset: saved }) };
}

function runClientActionTool(name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case "open_connect_broker":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "open_connect_broker",
          summary: "Open the connect broker modal",
        },
      };
    case "open_telegram_link":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "open_telegram_link",
          summary: "Open Copier Engine to link Telegram",
          args: { path: "/copier-engine" },
        },
      };
    case "navigate": {
      const path = String(args.path ?? "").trim();
      if (!NAV_ALLOWLIST.has(path)) {
        return { content: JSON.stringify({ error: `Path not allowed: ${path}` }) };
      }
      return {
        content: JSON.stringify({ queued: true, path }),
        pendingClientAction: {
          type: "navigate",
          summary: `Go to ${path}`,
          args: { path },
        },
      };
    }
    case "open_live_chat":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "open_live_chat",
          summary: "Open live chat with support",
        },
      };
    case "propose_config_change":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "propose_config_change",
          summary: String(args.summary ?? "Review configuration change"),
          args: {
            broker_account_id: args.broker_account_id,
            channel_id: args.channel_id,
            hint: args.hint,
            summary: args.summary,
          },
        },
      };
    default:
      return { content: JSON.stringify({ error: `Unknown client action: ${name}` }) };
  }
}

async function executeTool(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "get_setup_status":
      return toolGetSetupStatus(supabase, userId);
    case "set_copier_paused":
      return toolSetCopierPaused(supabase, userId, args);
    case "list_brokers":
      return toolListBrokers(supabase, userId);
    case "list_channels":
      return toolListChannels(supabase, userId);
    case "list_presets":
      return toolListPresets(supabase, userId);
    case "apply_preset":
      return toolApplyPreset(supabase, userId, args);
    case "save_preset":
      return toolSavePreset(supabase, userId, args);
    case "explain_feature": {
      const topic = String(args.topic ?? "");
      const text = FEATURE_TOPICS[topic];
      return {
        content: text
          ? JSON.stringify({ topic, explanation: text })
          : JSON.stringify({ error: `Unknown topic: ${topic}` }),
      };
    }
    case "open_connect_broker":
    case "open_telegram_link":
    case "navigate":
    case "open_live_chat":
    case "propose_config_change":
      return runClientActionTool(name, args);
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}

const EXECUTABLE_MUTATIONS = new Set(["set_copier_paused", "apply_preset", "save_preset"]);

function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/") &&
    value.includes(";base64,") &&
    value.length <= MAX_IMAGE_DATA_URL_CHARS
  );
}

function toOpenAiUserContent(text: string, images: string[]): string | ContentPart[] {
  const clipped = text.slice(0, 8000);
  const valid = images.filter(isImageDataUrl).slice(0, MAX_IMAGES_PER_MESSAGE);
  if (!valid.length) return clipped;
  return [
    { type: "text", text: clipped || "Please look at the attached image(s)." },
    ...valid.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

async function openaiChat(messages: ChatMessage[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data.error?.message
        ? String(data.error.message)
        : `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as {
    choices?: Array<{ message?: ChatMessage }>;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");
  if (!OPENAI_API_KEY) return bad(503, "OPENAI_API_KEY is not configured");

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return bad(401, "Unauthorized");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user) return bad(401, "Unauthorized");
  const userId = authData.user.id;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Confirmed mutation path (skip LLM).
  const execute = body.execute as { tool?: string; args?: Record<string, unknown> } | undefined;
  if (execute?.tool) {
    const tool = String(execute.tool);
    if (!EXECUTABLE_MUTATIONS.has(tool)) {
      return bad(400, "Tool cannot be executed directly");
    }
    const args = { ...(execute.args ?? {}), confirmed: true };
    const result = await executeTool(supabase, userId, tool, args);
    return Response.json(
      {
        assistant_message: result.content.includes('"ok":true') || result.content.includes('"ok": true')
          ? "Done."
          : "Action finished.",
        tool_results: [{ tool, result: result.content }],
        pending_client_actions: [],
        pending_confirmations: [],
      },
      { headers: corsHeaders },
    );
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = [
    { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
    ...incoming
      .filter((m: { role?: string; content?: string }) =>
        m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      )
      .slice(-20)
      .map((m: { role: string; content: string; images?: unknown }) => {
        const images = Array.isArray(m.images)
          ? m.images.filter(isImageDataUrl).slice(0, MAX_IMAGES_PER_MESSAGE)
          : [];
        if (m.role === "user" && images.length) {
          return { role: m.role, content: toOpenAiUserContent(m.content, images) };
        }
        return { role: m.role, content: m.content.slice(0, 8000) };
      }),
  ];

  if (messages.length < 2) return bad(400, "messages required");

  const pendingClientActions: PendingClientAction[] = [];
  const pendingConfirmations: PendingConfirmation[] = [];
  const toolResultsLog: Array<{ tool: string; result: string }> = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await openaiChat(messages);
      const msg = data.choices?.[0]?.message;
      if (!msg) return bad(502, "Empty model response");

      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) {
        return Response.json(
          {
            assistant_message: String(msg.content ?? "").trim() || "How can I help?",
            pending_client_actions: pendingClientActions,
            pending_confirmations: pendingConfirmations,
            tool_results: toolResultsLog,
          },
          { headers: corsHeaders },
        );
      }

      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        const args = parseArgs(call.function?.arguments ?? "{}");
        const result = await executeTool(supabase, userId, name, args);
        if (result.pendingClientAction) pendingClientActions.push(result.pendingClientAction);
        if (result.pendingConfirmation) pendingConfirmations.push(result.pendingConfirmation);
        toolResultsLog.push({ tool: name, result: result.content.slice(0, 4000) });
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: call.id,
        });
      }
    }

    // Exhausted rounds — ask model for a final text reply without tools.
    const final = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          ...messages,
          {
            role: "user",
            content: "Please give a short final answer to the user based on the tool results.",
          },
        ],
      }),
    });
    const finalData = await final.json().catch(() => ({}));
    const text =
      finalData?.choices?.[0]?.message?.content ??
      "I gathered some information — ask me if you want to take the next step.";

    return Response.json(
      {
        assistant_message: String(text).trim(),
        pending_client_actions: pendingClientActions,
        pending_confirmations: pendingConfirmations,
        tool_results: toolResultsLog,
      },
      { headers: corsHeaders },
    );
  } catch (err) {
    return bad(500, err instanceof Error ? err.message : "Assistant failed");
  }
});
