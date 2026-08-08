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
import {
  mergeManualSettings,
  normalizeChannelUsername,
  sanitizeManualPatch,
  summarizeManualPatch,
} from "../_shared/assistantConfigTools.ts";

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
  "/brokers",
  "/account-configuration",
  "/channels",
  "/backtest",
  "/billing",
  "/contact-support",
  "/pricing",
]);

/** Map legacy assistant paths to real routes (never /account-config — that hits /:referralCode → signup). */
function normalizeNavPath(path: string): string {
  if (path === "/account-config" || path === "/account-configuration") return "/brokers";
  return path;
}

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
        "Pause or resume the ENTIRE copier for the user (all brokers). Do NOT use this to stop a single broker — use set_broker_active instead. Call first without confirmed; UI will confirm, then client re-executes with confirmed=true.",
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
      name: "set_broker_active",
      description:
        "Enable or disable copying on ONE broker (broker_accounts.is_active). Use for stop/resume a specific account (e.g. Exness Demo). is_active=true resumes copying; is_active=false stops it. Never pause other brokers automatically. If plan limit blocks activation, return an error telling the user to pause another active broker or upgrade. Never use set_copier_paused for a single broker.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string" },
          label: { type: "string", description: "Broker display label, e.g. Exness Demo" },
          is_active: {
            type: "boolean",
            description: "true = copy to this broker; false = stop copying to this broker only",
          },
          confirmed: { type: "boolean" },
        },
        required: ["is_active"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_brokers",
      description:
        "List the user's broker accounts (id, label, account_login / MT login, platform, server, connected).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_channels",
      description: "List active Telegram channels for the user (id, display_name, channel_username).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_channel_config",
      description:
        "Read current trading config for a broker+channel. Resolve broker by broker_account_id OR account_login (MT login like 928883). Resolve channel by channel_id OR channel_username.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string", description: "MT4/MT5 account number / login" },
          channel_id: { type: "string" },
          channel_username: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_channel_config",
      description:
        "Create or update trading settings for a channel on a broker (lot size, multi-trade, range, etc.). Call WITHOUT confirmed first so the UI can Confirm; then client re-executes with confirmed=true. Resolve broker by id or account_login; channel by id or username. Only after a confirmed write returns ok may you say settings were updated; then offer save_preset if the user wants a named preset. Opening the config UI is open_broker_config, not this tool.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string" },
          channel_id: { type: "string" },
          channel_username: { type: "string" },
          copier_mode: { type: "string", enum: ["manual", "ai"] },
          settings: {
            type: "object",
            description:
              "Partial manual_settings patch. Common keys: fixed_lot, risk_mode, dynamic_balance_percent, trade_style (single|multi), multi_trade_leg_percent, range_trading, range_percent, range_step_pips, range_distance_pips, range_layering_type, reverse_signal, symbol_prefix, symbol_suffix.",
            additionalProperties: true,
          },
          summary: {
            type: "string",
            description: "Short human summary of the change for the Confirm card",
          },
          confirmed: { type: "boolean" },
        },
        required: ["settings"],
        additionalProperties: false,
      },
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
        "Apply a preset to a channel on a broker. Resolve broker by broker_account_id or account_login; channel by channel_id or channel_username. Use confirmed only after UI confirm.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string" },
          channel_id: { type: "string" },
          channel_username: { type: "string" },
          preset_id: { type: "string" },
          preset_name: { type: "string" },
          confirmed: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_preset",
      description:
        "Save current channel config on a broker as a named preset. Resolve broker/channel like apply_preset. Use confirmed after UI confirm. Offer this after update_channel_config when the user wants to reuse settings.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string" },
          channel_id: { type: "string" },
          channel_username: { type: "string" },
          name: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["name"],
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
      name: "start_broker_connect",
      description:
        "Start in-chat MT4/MT5 broker connection. Pass optional non-secret fields (platform, account_login, broker_server, label). Password is collected only in a secure UI card — never ask for it in chat.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["MT4", "MT5"] },
          account_login: { type: "string" },
          broker_server: { type: "string" },
          label: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_connect_broker",
      description:
        "Alias for start_broker_connect (in-chat secure password card). Prefer start_broker_connect when the user wants to connect a broker.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["MT4", "MT5"] },
          account_login: { type: "string" },
          broker_server: { type: "string" },
          label: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_telegram_link",
      description:
        "Start in-chat Telegram phone linking. Shows a secure phone/OTP card in the assistant panel. Prefer this when the user wants to link Telegram.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_telegram_link",
      description:
        "Alias for start_telegram_link (in-chat phone OTP). For QR login, use navigate to /copier-engine instead.",
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
            description:
              "One of: /dashboard /copier-engine /brokers /channels /backtest /billing /contact-support /pricing",
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
      name: "list_backtests",
      description:
        "List the user's recent signal backtest runs (status, dates, total pips / summary). Use when they ask about past backtests or results.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max runs to return (default 10, max 20)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_backtest",
      description:
        "Open the Backtest page (/backtest) so the user can pull channel signals and run a backtest. Prefer this when they ask to run a backtest or open the backtest page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_broker_config",
      description:
        "Open the Brokers page (/brokers) and the configuration modal for a broker. This only opens the UI — it does NOT change trading settings. Prefer this when the user asks to open broker configuration / account config. If they have multiple brokers and did not specify which, call without identifiers — the tool returns the list so you can ask which one. After they name a broker (label or login), call again with account_login or label.",
      parameters: {
        type: "object",
        properties: {
          broker_account_id: { type: "string" },
          account_login: { type: "string", description: "MT account login, e.g. 928883" },
          label: { type: "string", description: "Broker display label, e.g. Exness Demo" },
        },
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
        "Deprecated for writing settings — prefer update_channel_config. Opens broker configuration UI (same as open_broker_config) as a fallback.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          broker_account_id: { type: "string" },
          account_login: { type: "string" },
          label: { type: "string" },
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
        .select("id,label,account_login,platform,is_active,fxsocket_account_id")
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
    .select("id,label,account_login,platform,is_active,fxsocket_account_id,broker_server,broker_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return { content: JSON.stringify({ error: error.message }) };
  return {
    content: JSON.stringify({
      brokers: (data ?? []).map((b) => ({
        id: b.id,
        label: b.label || b.broker_name || b.account_login || b.id,
        account_login: b.account_login ?? null,
        platform: b.platform,
        is_active: b.is_active,
        copying: b.is_active === true,
        connected: Boolean(b.fxsocket_account_id),
        broker_server: b.broker_server ?? null,
      })),
    }),
  };
}

type ResolvedBroker = { id: string; account_login: string | null; label: string | null };
type ResolvedChannel = { id: string; display_name: string | null; channel_username: string | null };

async function resolveBroker(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<{ broker: ResolvedBroker } | { error: string }> {
  const id = String(args.broker_account_id ?? "").trim();
  const login = String(args.account_login ?? args.broker_login ?? "").trim();
  const labelQuery = String(args.label ?? args.broker_label ?? "").trim().toLowerCase();

  if (id) {
    const { data, error } = await supabase
      .from("broker_accounts")
      .select("id,account_login,label")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Broker not found" };
    return {
      broker: {
        id: data.id,
        account_login: data.account_login ?? null,
        label: data.label ?? null,
      },
    };
  }

  if (login) {
    const { data, error } = await supabase
      .from("broker_accounts")
      .select("id,account_login,label")
      .eq("user_id", userId)
      .eq("account_login", login)
      .maybeSingle();
    if (error) return { error: error.message };
    if (data) {
      return {
        broker: {
          id: data.id,
          account_login: data.account_login ?? null,
          label: data.label ?? null,
        },
      };
    }
    // Fallback: scan (logins sometimes stored with whitespace)
    const { data: all } = await supabase
      .from("broker_accounts")
      .select("id,account_login,label")
      .eq("user_id", userId);
    const hit = (all ?? []).find(
      (b) => String(b.account_login ?? "").trim() === login,
    );
    if (hit) {
      return {
        broker: {
          id: hit.id,
          account_login: hit.account_login ?? null,
          label: hit.label ?? null,
        },
      };
    }
    return { error: `No broker found with account login ${login}` };
  }

  if (labelQuery) {
    const { data: all, error } = await supabase
      .from("broker_accounts")
      .select("id,account_login,label")
      .eq("user_id", userId);
    if (error) return { error: error.message };
    const matches = (all ?? []).filter((b) => {
      const label = String(b.label ?? "").trim().toLowerCase();
      return label === labelQuery || label.includes(labelQuery);
    });
    if (matches.length === 1) {
      const hit = matches[0];
      return {
        broker: {
          id: hit.id,
          account_login: hit.account_login ?? null,
          label: hit.label ?? null,
        },
      };
    }
    if (matches.length > 1) {
      return {
        error: `Multiple brokers match "${labelQuery}". Specify account_login.`,
      };
    }
    return { error: `No broker found matching label "${labelQuery}"` };
  }

  return { error: "Provide broker_account_id, account_login, or label" };
}

async function resolveChannel(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<{ channel: ResolvedChannel } | { error: string }> {
  const id = String(args.channel_id ?? "").trim();
  const username = normalizeChannelUsername(String(args.channel_username ?? ""));

  if (id) {
    const { data, error } = await supabase
      .from("telegram_channels")
      .select("id,display_name,channel_username")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Channel not found" };
    return {
      channel: {
        id: data.id,
        display_name: data.display_name ?? null,
        channel_username: data.channel_username ?? null,
      },
    };
  }

  if (username) {
    const { data: rows, error } = await supabase
      .from("telegram_channels")
      .select("id,display_name,channel_username")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) return { error: error.message };
    const hit = (rows ?? []).find(
      (c) => normalizeChannelUsername(String(c.channel_username ?? "")) === username
        || normalizeChannelUsername(String(c.display_name ?? "")) === username,
    );
    if (!hit) return { error: `No active channel matching @${username}` };
    return {
      channel: {
        id: hit.id,
        display_name: hit.display_name ?? null,
        channel_username: hit.channel_username ?? null,
      },
    };
  }

  return { error: "Provide channel_id or channel_username" };
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

async function toolListBacktests(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limitRaw = Number(args.limit ?? 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 10;
  const { data, error } = await supabase
    .from("backtest_runs")
    .select("id, name, status, summary, config, created_at, completed_at, error_message")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return { content: JSON.stringify({ error: error.message }) };

  const runs = (data ?? [])
    .filter((row) => {
      const cfg = row.config && typeof row.config === "object"
        ? (row.config as Record<string, unknown>)
        : {};
      return cfg.syncOnly !== true;
    })
    .slice(0, limit)
    .map((row) => {
      const summary = row.summary && typeof row.summary === "object"
        ? (row.summary as Record<string, unknown>)
        : null;
      const cfg = row.config && typeof row.config === "object"
        ? (row.config as Record<string, unknown>)
        : {};
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
        error_message: row.error_message,
        date_from: cfg.dateFrom ?? null,
        date_to: cfg.dateTo ?? null,
        symbols: Array.isArray(cfg.symbols) ? cfg.symbols : null,
        total_pips: summary?.totalPips ?? null,
        win_rate: summary?.winRate ?? null,
        net_pnl: summary?.netPnl ?? null,
        traded_signals: summary?.tradedSignals ?? null,
      };
    });

  return {
    content: JSON.stringify({
      runs,
      hint: "To run a new backtest, call open_backtest and guide: pick channel → date range → Pull signals → pick symbol → Run.",
    }),
  };
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
        summary: paused
          ? "Pause the entire copier for all brokers?"
          : "Resume the entire copier for all brokers?",
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

async function toolSetBrokerActive(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const rawActive = args.is_active ?? args.active ?? args.enabled ?? args.copying;
  let isActive: boolean | null = null;
  if (typeof rawActive === "boolean") isActive = rawActive;
  else if (rawActive === "true" || rawActive === 1 || rawActive === "1") isActive = true;
  else if (rawActive === "false" || rawActive === 0 || rawActive === "0") isActive = false;
  if (isActive == null) {
    return { content: JSON.stringify({ error: "is_active boolean required (true to resume copying, false to stop)" }) };
  }

  const brokerRes = await resolveBroker(supabase, userId, args);
  if ("error" in brokerRes) return { content: JSON.stringify({ error: brokerRes.error }) };
  const broker = brokerRes.broker;
  const name = broker.label || broker.account_login || broker.id;

  const resolvedArgs = {
    broker_account_id: broker.id,
    account_login: broker.account_login ?? undefined,
    label: broker.label ?? undefined,
    is_active: isActive,
  };

  if (args.confirmed !== true) {
    return {
      content: JSON.stringify({ needs_confirmation: true, ...resolvedArgs }),
      pendingConfirmation: {
        tool: "set_broker_active",
        args: resolvedArgs,
        summary: isActive
          ? `Start copying on "${name}"?`
          : `Stop copying on "${name}" only (other brokers keep running)?`,
      },
    };
  }

  const { error } = await supabase
    .from("broker_accounts")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", broker.id)
    .eq("user_id", userId);
  if (error) {
    const friendly = planLimitFriendly(error.message);
    // Helpful guidance when Basic (1 active) blocks reactivation — never auto-pause others.
    if (/broker account/i.test(friendly) || /broker_account_limit/i.test(error.message)) {
      const { data: active } = await supabase
        .from("broker_accounts")
        .select("label,account_login")
        .eq("user_id", userId)
        .eq("is_active", true)
        .neq("id", broker.id);
      const names = (active ?? [])
        .map((b) => b.label || b.account_login)
        .filter(Boolean)
        .join(", ");
      return {
        content: JSON.stringify({
          error: names
            ? `${friendly} Currently active: ${names}. Pause that account first, or upgrade to Advanced for multiple active brokers.`
            : `${friendly} Pause another active broker first, or upgrade to Advanced.`,
        }),
      };
    }
    return { content: JSON.stringify({ error: friendly }) };
  }
  return {
    content: JSON.stringify({
      ok: true,
      broker_account_id: broker.id,
      label: broker.label,
      account_login: broker.account_login,
      is_active: isActive,
    }),
  };
}

function planLimitFriendly(raw: string): string {
  const m = /^(channel_limit|broker_account_limit|subscription_required):\s*(.+)$/i.exec(raw.trim());
  return m?.[2]?.trim() || raw;
}

async function toolGetChannelConfig(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const brokerRes = await resolveBroker(supabase, userId, args);
  if ("error" in brokerRes) return { content: JSON.stringify({ error: brokerRes.error }) };
  const channelRes = await resolveChannel(supabase, userId, args);
  if ("error" in channelRes) return { content: JSON.stringify({ error: channelRes.error }) };
  const brokerId = brokerRes.broker.id;
  const channelId = channelRes.channel.id;

  const { data: row } = await supabase
    .from("broker_channel_trading_configs")
    .select("copier_mode,manual_settings,updated_at")
    .eq("broker_account_id", brokerId)
    .eq("channel_id", channelId)
    .maybeSingle();

  const { data: broker } = await supabase
    .from("broker_accounts")
    .select("signal_channel_ids,channel_trading_configs")
    .eq("id", brokerId)
    .eq("user_id", userId)
    .maybeSingle();

  let mode = row?.copier_mode === "ai" ? "ai" : "manual";
  let manual = (row?.manual_settings && typeof row.manual_settings === "object"
    ? row.manual_settings
    : null) as Record<string, unknown> | null;

  if (!manual) {
    const map =
      broker?.channel_trading_configs && typeof broker.channel_trading_configs === "object"
        ? (broker.channel_trading_configs as Record<string, unknown>)
        : {};
    const entry = map[channelId] as Record<string, unknown> | undefined;
    if (entry?.manual_settings && typeof entry.manual_settings === "object") {
      manual = entry.manual_settings as Record<string, unknown>;
      mode = entry.copier_mode === "ai" ? "ai" : "manual";
    }
  }

  const assigned = Array.isArray(broker?.signal_channel_ids)
    && broker!.signal_channel_ids.map(String).includes(channelId);

  return {
    content: JSON.stringify({
      broker: brokerRes.broker,
      channel: channelRes.channel,
      assigned_to_broker: assigned,
      configured: Boolean(manual),
      copier_mode: mode,
      manual_settings: manual ?? {},
      updated_at: row?.updated_at ?? null,
    }),
  };
}

async function toolUpdateChannelConfig(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const brokerRes = await resolveBroker(supabase, userId, args);
  if ("error" in brokerRes) return { content: JSON.stringify({ error: brokerRes.error }) };
  const channelRes = await resolveChannel(supabase, userId, args);
  if ("error" in channelRes) return { content: JSON.stringify({ error: channelRes.error }) };

  const patch = sanitizeManualPatch(args.settings);
  if (!Object.keys(patch).length) {
    return { content: JSON.stringify({ error: "settings patch is empty or has no allowed keys" }) };
  }

  const brokerId = brokerRes.broker.id;
  const channelId = channelRes.channel.id;
  const mode = args.copier_mode === "ai" ? "ai" : "manual";
  const patchSummary = String(args.summary ?? "").trim() || summarizeManualPatch(patch);
  const brokerLabel = brokerRes.broker.account_login || brokerRes.broker.label || brokerId;
  const channelLabel =
    channelRes.channel.channel_username || channelRes.channel.display_name || channelId;

  const resolvedArgs = {
    broker_account_id: brokerId,
    channel_id: channelId,
    account_login: brokerRes.broker.account_login ?? undefined,
    channel_username: channelRes.channel.channel_username ?? undefined,
    copier_mode: mode,
    settings: patch,
    summary: patchSummary,
  };

  if (args.confirmed !== true) {
    return {
      content: JSON.stringify({ needs_confirmation: true, ...resolvedArgs }),
      pendingConfirmation: {
        tool: "update_channel_config",
        args: resolvedArgs,
        summary: `Apply config on broker ${brokerLabel} / ${channelLabel}: ${patchSummary}?`,
      },
    };
  }

  const { data: existing } = await supabase
    .from("broker_channel_trading_configs")
    .select("manual_settings")
    .eq("broker_account_id", brokerId)
    .eq("channel_id", channelId)
    .maybeSingle();

  const { data: broker, error: brokerErr } = await supabase
    .from("broker_accounts")
    .select("id,channel_trading_configs,signal_channel_ids")
    .eq("id", brokerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (brokerErr || !broker) {
    return { content: JSON.stringify({ error: brokerErr?.message ?? "Broker not found" }) };
  }

  let current: Record<string, unknown> = {};
  if (existing?.manual_settings && typeof existing.manual_settings === "object") {
    current = existing.manual_settings as Record<string, unknown>;
  } else {
    const map =
      broker.channel_trading_configs && typeof broker.channel_trading_configs === "object"
        ? (broker.channel_trading_configs as Record<string, unknown>)
        : {};
    const entry = map[channelId] as Record<string, unknown> | undefined;
    if (entry?.manual_settings && typeof entry.manual_settings === "object") {
      current = entry.manual_settings as Record<string, unknown>;
    }
  }

  const manual = mergeManualSettings(current, patch);

  const { error: upsertErr } = await supabase.from("broker_channel_trading_configs").upsert(
    {
      user_id: userId,
      broker_account_id: brokerId,
      channel_id: channelId,
      copier_mode: mode,
      manual_settings: manual,
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
    manual_settings: manual,
    ai_settings: {},
  };
  const signalIds = Array.isArray(broker.signal_channel_ids)
    ? [...broker.signal_channel_ids.map(String)]
    : [];
  if (!signalIds.includes(channelId)) signalIds.push(channelId);

  const { error: upErr } = await supabase
    .from("broker_accounts")
    .update({
      channel_trading_configs: configs,
      signal_channel_ids: signalIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", brokerId)
    .eq("user_id", userId);
  if (upErr) return { content: JSON.stringify({ error: upErr.message }) };

  return {
    content: JSON.stringify({
      ok: true,
      broker_account_id: brokerId,
      channel_id: channelId,
      account_login: brokerRes.broker.account_login,
      applied: patch,
      hint: "Offer to save_preset if the user wants to reuse these settings.",
    }),
  };
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
  const brokerRes = await resolveBroker(supabase, userId, args);
  if ("error" in brokerRes) return { content: JSON.stringify({ error: brokerRes.error }) };
  const channelRes = await resolveChannel(supabase, userId, args);
  if ("error" in channelRes) return { content: JSON.stringify({ error: channelRes.error }) };
  const brokerId = brokerRes.broker.id;
  const channelId = channelRes.channel.id;

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
  const name = String(args.name ?? "").trim();
  if (!name) {
    return { content: JSON.stringify({ error: "name required" }) };
  }
  const brokerRes = await resolveBroker(supabase, userId, args);
  if ("error" in brokerRes) return { content: JSON.stringify({ error: brokerRes.error }) };
  const channelRes = await resolveChannel(supabase, userId, args);
  if ("error" in channelRes) return { content: JSON.stringify({ error: channelRes.error }) };
  const brokerId = brokerRes.broker.id;
  const channelId = channelRes.channel.id;

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

function brokerChoiceSummary(
  brokers: Array<{ id: string; account_login: string | null; label: string | null; platform?: string | null }>,
) {
  return brokers.map((b) => ({
    id: b.id,
    account_login: b.account_login ?? null,
    label: b.label ?? null,
    platform: b.platform ?? null,
  }));
}

async function toolOpenBrokerConfig(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { data: brokers, error } = await supabase
    .from("broker_accounts")
    .select("id,account_login,label,platform")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return { content: JSON.stringify({ error: error.message }) };
  const list = brokers ?? [];
  if (list.length === 0) {
    return {
      content: JSON.stringify({
        error: "No brokers connected. Use start_broker_connect first, then open configuration.",
      }),
    };
  }

  const hasSpecifier = Boolean(
    String(args.broker_account_id ?? "").trim() ||
      String(args.account_login ?? args.broker_login ?? "").trim() ||
      String(args.label ?? args.broker_label ?? "").trim(),
  );

  if (hasSpecifier) {
    const resolved = await resolveBroker(supabase, userId, args);
    if ("error" in resolved) {
      return {
        content: JSON.stringify({
          error: resolved.error,
          brokers: brokerChoiceSummary(list),
          hint: "Ask which broker to open, then call open_broker_config with account_login or label.",
        }),
      };
    }
    const name = resolved.broker.label || resolved.broker.account_login || resolved.broker.id;
    return {
      content: JSON.stringify({
        queued: true,
        settings_changed: false,
        message:
          "Configuration UI opened only. No trading settings were updated. Tell the user the config modal is open — do not claim settings were saved or updated.",
        broker: resolved.broker,
      }),
      pendingClientAction: {
        type: "open_broker_config",
        summary: `Open configuration for ${name}`,
        args: { broker_account_id: resolved.broker.id },
      },
    };
  }

  if (list.length === 1) {
    const b = list[0];
    const name = b.label || b.account_login || b.id;
    return {
      content: JSON.stringify({
        queued: true,
        settings_changed: false,
        message:
          "Configuration UI opened only. No trading settings were updated. Tell the user the config modal is open — do not claim settings were saved or updated.",
        broker: { id: b.id, account_login: b.account_login ?? null, label: b.label ?? null },
      }),
      pendingClientAction: {
        type: "open_broker_config",
        summary: `Open configuration for ${name}`,
        args: { broker_account_id: b.id },
      },
    };
  }

  return {
    content: JSON.stringify({
      needs_broker_choice: true,
      message:
        "Multiple brokers found. Ask the user which broker configuration to open (by label or account login), then call open_broker_config again with account_login or label.",
      brokers: brokerChoiceSummary(list),
    }),
  };
}

function runClientActionTool(name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case "open_connect_broker":
    case "start_broker_connect":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "start_broker_connect",
          summary: "Start in-chat broker connect",
          args: {
            platform: args.platform,
            account_login: args.account_login,
            broker_server: args.broker_server,
            label: args.label,
          },
        },
      };
    case "open_telegram_link":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "open_telegram_link",
          summary: "Start in-chat Telegram link",
          args: { path: "/copier-engine" },
        },
      };
    case "start_telegram_link":
      return {
        content: JSON.stringify({ queued: true }),
        pendingClientAction: {
          type: "start_telegram_link",
          summary: "Start in-chat Telegram phone link",
        },
      };
    case "navigate": {
      const raw = String(args.path ?? "").trim();
      const path = normalizeNavPath(raw);
      if (!NAV_ALLOWLIST.has(path) && !NAV_ALLOWLIST.has(raw)) {
        return { content: JSON.stringify({ error: `Path not allowed: ${raw}` }) };
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
    case "open_backtest":
      return {
        content: JSON.stringify({ queued: true, path: "/backtest" }),
        pendingClientAction: {
          type: "navigate",
          summary: "Open Backtest",
          args: { path: "/backtest" },
        },
      };
    case "propose_config_change":
      // Handled in executeTool via toolOpenBrokerConfig (needs broker resolution).
      return { content: JSON.stringify({ error: "Use open_broker_config" }) };
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
    case "set_broker_active":
      return toolSetBrokerActive(supabase, userId, args);
    case "list_brokers":
      return toolListBrokers(supabase, userId);
    case "list_channels":
      return toolListChannels(supabase, userId);
    case "get_channel_config":
      return toolGetChannelConfig(supabase, userId, args);
    case "update_channel_config":
      return toolUpdateChannelConfig(supabase, userId, args);
    case "list_presets":
      return toolListPresets(supabase, userId);
    case "list_backtests":
      return toolListBacktests(supabase, userId, args);
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
    case "open_broker_config":
    case "propose_config_change":
      return toolOpenBrokerConfig(supabase, userId, args);
    case "open_connect_broker":
    case "start_broker_connect":
    case "open_telegram_link":
    case "start_telegram_link":
    case "open_backtest":
    case "navigate":
    case "open_live_chat":
      return runClientActionTool(name, args);
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}

const EXECUTABLE_MUTATIONS = new Set([
  "set_copier_paused",
  "set_broker_active",
  "apply_preset",
  "save_preset",
  "update_channel_config",
]);

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
    let parsed: { ok?: boolean; error?: string } = {};
    try {
      parsed = JSON.parse(result.content) as { ok?: boolean; error?: string };
    } catch {
      parsed = {};
    }
    const ok = parsed.ok === true || result.content.includes('"ok":true') || result.content.includes('"ok": true');
    let assistant_message = ok ? "Done." : (parsed.error || "Action finished.");
    if (ok && tool === "update_channel_config") {
      assistant_message =
        "Configuration saved. Want me to save this as a named preset?";
    } else if (ok && tool === "save_preset") {
      assistant_message = "Preset saved.";
    } else if (ok && tool === "apply_preset") {
      assistant_message = "Preset applied.";
    } else if (ok && tool === "set_broker_active") {
      assistant_message = args.is_active === false || args.is_active === "false"
        ? "Stopped copying on that broker."
        : "That broker is copying again.";
    } else if (ok && tool === "set_copier_paused") {
      assistant_message = "Copier pause setting updated.";
    }
    return Response.json(
      {
        assistant_message,
        tool_results: [{ tool, result: result.content }],
        pending_client_actions: [],
        pending_confirmations: [],
        ...(parsed.error ? { error: parsed.error } : {}),
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
