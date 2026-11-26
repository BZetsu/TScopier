/**
 * Read-only account tools, shared by the customer-facing surfaces.
 *
 * These exist so the support chat can answer "is my account connected", "what
 * happened to my trade" and "why was my signal skipped" instead of guessing or
 * escalating. They only read, and every query is scoped to the user id the
 * caller has already authenticated — never an id supplied by the model.
 *
 * Only read paths belong here. Nothing in this module may write: the support
 * chat runs with the service role, so a write tool would let a conversation
 * change a customer's broker configuration.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildAccountPlanContext } from "./accountPlanContext.ts";
import {
  brokerEffectiveConnectionStatus,
  isBrokerSessionConnected,
} from "./brokerConnectionStatus.ts";
import {
  loadLiveSubscriptionExtension,
  loadUserIsAdminResult,
  loadUserSubscriptionResult,
} from "./subscriptionAccess.ts";

export type ToolResult = { content: string };

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function failure(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }) };
}

/** Model-visible broker summary without internal IDs, login IDs, or server names. */
export function summarizeBroker(broker: Record<string, unknown>) {
  return {
    label: String(broker.label || broker.broker_name || "Unnamed account"),
    platform: broker.platform ?? null,
    provider: broker.provider ?? null,
    is_active: broker.is_active === true,
    copying: broker.is_active === true,
    connected: isBrokerSessionConnected(broker),
    connection_status: brokerEffectiveConnectionStatus(broker),
  };
}

/** Account-context summary without broker login IDs or server names. */
export function summarizeBrokerForAccountContext(broker: Record<string, unknown>) {
  return summarizeBroker(broker);
}

/** Read the effective plan and access type from an account-context payload. */
export function summarizeAccountContextAccess(account: {
  subscription?: unknown;
  effective_plan?: unknown;
  access?: unknown;
}): { effective_plan: string | null; access: string | null } {
  const subscription =
    account.subscription && typeof account.subscription === "object"
      ? (account.subscription as Record<string, unknown>)
      : null;
  const effectivePlan = subscription?.effective_plan ?? account.effective_plan;
  const access = subscription?.access ?? account.access;
  return {
    effective_plan: typeof effectivePlan === "string" ? effectivePlan : null,
    access: typeof access === "string" ? access : null,
  };
}

export function summarizeChannel(channel: Record<string, unknown>) {
  const source = String(channel.source_kind || "telegram").trim().toLowerCase();
  const isTelegramSource = source === "telegram";
  const active = channel.is_active === true;
  return {
    name: String(channel.display_name || channel.channel_username || "Unnamed channel"),
    username: channel.channel_username || null,
    source,
    active,
    is_telegram_source: isTelegramSource,
    // Only active Telegram channels consume the reported Telegram allowance.
    // Other source kinds and paused Telegram rows remain visible but do not
    // inflate that figure. This reporting rule does not change entitlement.
    consumes_telegram_slot: isTelegramSource && active,
    counts_toward_telegram_limit: isTelegramSource && active,
  };
}

/** The customer's broker accounts, with a plain answer to "is it connected". */
export async function toolListBrokers(
  supabase: SupabaseClient,
  userId: string,
): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("broker_accounts")
    .select(
      "label,platform,is_active,provider,connection_status,fxsocket_status,mtapi_status,ctrader_status,binance_status,bybit_status,kucoin_status,dxtrade_status,tradelocker_status,matchtrader_status,terminal_connected,trade_allowed,broker_name",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return failure(error.message);

  return {
    content: JSON.stringify({
      brokers: (data ?? []).map((broker) => summarizeBroker(broker)),
      hint: "This is the Account Configuration page. Say plainly which accounts are connected and which are paused; do not invent accounts.",
    }),
  };
}

/**
 * The signed-in customer's plan, calculated limits, signal channels and broker
 * accounts. The user id always comes from the authenticated actor; the model
 * cannot supply or broaden it.
 */
export async function toolGetAccountContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ToolResult> {
  const [subscriptionResult, adminResult, channelsResult, brokersResult] =
    await Promise.all([
      loadUserSubscriptionResult(supabase, userId),
      loadUserIsAdminResult(supabase, userId),
      supabase
        .from("telegram_channels")
        .select("id,display_name,channel_username,is_active,source_kind")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("broker_accounts")
        .select(
          "label,platform,is_active,provider,connection_status,fxsocket_status,mtapi_status,ctrader_status,binance_status,bybit_status,kucoin_status,dxtrade_status,tradelocker_status,matchtrader_status,terminal_connected,trade_allowed,broker_name",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

  if (
    subscriptionResult.error ||
    adminResult.error ||
    channelsResult.error ||
    brokersResult.error
  ) {
    return failure("Unable to verify account state. Please try again.");
  }

  const subscription = subscriptionResult.data;
  const isAdmin = adminResult.isAdmin;

  let planContext = buildAccountPlanContext({
    plan: subscription?.plan,
    status: subscription?.status,
    trialEndsAt: subscription?.trial_ends_at,
    extraAccounts: subscription?.extra_accounts,
    isAdmin,
  });

  if (!planContext.effective_plan && !isAdmin) {
    const extensionResult = await loadLiveSubscriptionExtension(
      supabase,
      userId,
      subscription,
    );
    if (extensionResult.error) {
      return failure("Unable to verify account state. Please try again.");
    }
    if (extensionResult.hasLiveExtension) {
      planContext = buildAccountPlanContext({
        plan: subscription?.plan,
        status: subscription?.status,
        trialEndsAt: subscription?.trial_ends_at,
        extraAccounts: subscription?.extra_accounts,
        isAdmin,
        hasLiveExtension: true,
      });
    }
  }

  const channels = (channelsResult.data ?? []).map((channel) =>
    summarizeChannel(channel),
  );
  const brokers = (brokersResult.data ?? []).map((broker) =>
    summarizeBrokerForAccountContext(broker),
  );
  const telegramChannels = channels.filter(
    (channel) => channel.is_telegram_source,
  );
  const activeTelegramChannelCount = telegramChannels.filter(
    (channel) => channel.consumes_telegram_slot,
  ).length;
  const maxTelegramChannels = planContext.limits?.max_telegram_channels ?? null;

  return {
    content: JSON.stringify({
      subscription: {
        plan: planContext.subscription_plan,
        status: planContext.subscription_status,
        effective_plan: planContext.effective_plan,
        access: planContext.access,
        trial_ends_at: subscription?.trial_ends_at ?? null,
        current_period_end: subscription?.current_period_end ?? null,
        extra_accounts: subscription?.extra_accounts ?? 0,
      },
      limits: planContext.limits,
      usage: {
        channels_total: channels.length,
        channels_active: channels.filter((channel) => channel.active).length,
        telegram_channels_total: telegramChannels.length,
        telegram_channels_active: activeTelegramChannelCount,
        reported_active_telegram_count_within_limit:
          planContext.limits == null
            ? null
            : maxTelegramChannels == null
              ? true
              : activeTelegramChannelCount <= maxTelegramChannels,
        brokers_total: brokers.length,
        brokers_active: brokers.filter((broker) => broker.is_active).length,
        brokers_connected: brokers.filter(
          (broker) => broker.is_active && broker.connected,
        ).length,
        brokers_connected_total: brokers.filter((broker) => broker.connected).length,
      },
      channels,
      brokers,
      hint: "These are the signed-in customer's real plan, calculated limits and connected accounts/channels. Use the tool values instead of guessing. subscription.plan is the billed plan; effective_plan and access describe current entitlement treatment. Compare telegram_channels_active with max_telegram_channels only for the assistant's Telegram-only reporting figure. This comparison is not a whole-account entitlement verdict because product enforcement also considers active non-Telegram sources. brokers_connected counts active-and-connected accounts for compatibility; brokers_connected_total includes connected accounts that are paused. A null numeric limit means unlimited. Do not confuse signal channels with broker accounts.",
    }),
  };
}

/** Recent trade rows for the customer's accounts. */
export async function toolGetRecentTrades(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limit = clamp(args.limit, 5, 1, 10);
  const { data, error } = await supabase
    .from("trades")
    .select(
      "symbol,direction,lot_size,status,opened_at,closed_at,profit,close_reason,broker_position_ticket,created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return failure(error.message);

  return {
    content: JSON.stringify({
      trades: (data ?? []).map((t) => ({
        symbol: t.symbol,
        direction: t.direction,
        lot_size: t.lot_size,
        status: t.status,
        opened_at: t.opened_at,
        closed_at: t.closed_at,
        profit: t.profit,
        close_reason: t.close_reason,
        ticket: t.broker_position_ticket ?? null,
        created_at: t.created_at,
      })),
      hint: "These are real broker positions. If the list is empty, say no trades were placed; never invent one. Quote the ticket when the customer asks whether a trade is still open.",
    }),
  };
}

/** Recent copier activity: executed, skipped, failed or pending signals. */
export async function toolGetCopierLogs(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limit = clamp(args.limit, 10, 1, 20);
  const status = String(args.status ?? "").trim().toLowerCase();

  let query = supabase
    .from("signals")
    .select("status,skip_reason,created_at,parsed_data,source_display_name,channel_id")
    .eq("user_id", userId)
    .is("parent_signal_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return failure(error.message);

  return {
    content: JSON.stringify({
      logs: (data ?? []).map((s) => {
        const parsed = (s.parsed_data ?? {}) as Record<string, unknown>;
        const symbol = typeof parsed.symbol === "string" ? parsed.symbol : null;
        return {
          status: s.status,
          symbol,
          skip_reason: s.skip_reason ?? null,
          channel: s.source_display_name ?? null,
          created_at: s.created_at,
        };
      }),
      hint: "This mirrors the Copier Logs page. A skipped row never reached the broker — explain the skip_reason plainly and never describe it as a trade.",
    }),
  };
}

/** JSON schemas for the tools above, ready to pass to the model. */
export const READ_ONLY_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_account_context",
      description:
        "Get the signed-in customer's actual subscription plan and status, calculated plan limits, connected signal channels, active Telegram-channel reporting count, and broker accounts. Use this for questions about plan price or limits, how many channels can be connected, whether connected channels are active, or whether the reported active Telegram count is within the displayed Telegram limit. Do not treat that comparison as a whole-account entitlement verdict.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_brokers",
      description:
        "List the signed-in customer's broker accounts: label, platform, provider, whether copying is enabled, and the effective connection state. Internal IDs, broker login IDs, server names, and provider-session values are omitted. Use before answering anything about their account setup.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_trades",
      description:
        "List the signed-in customer's recent broker trades with symbol, direction, lot, status, ticket and profit. Use for 'did my trade execute', 'is it still open', 'what happened to my trade'.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many trades to return (default 5, max 10)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_copier_logs",
      description:
        "List the signed-in customer's recent copier activity: executed, skipped, failed or pending signals with the reason. Use for 'why was my signal not copied', 'why is this one skipped'.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many rows to return (default 10, max 20)" },
          status: {
            type: "string",
            description: "Optional filter: executed, skipped, failed, pending, parsed, ignored",
          },
        },
        additionalProperties: false,
      },
    },
  },
] as const;

/** Dispatch a tool call by name. Returns null for an unknown tool. */
export async function runReadOnlyTool(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (name === "get_account_context") {
    return await toolGetAccountContext(supabase, userId);
  }
  if (name === "list_brokers") return await toolListBrokers(supabase, userId);
  if (name === "get_recent_trades") return await toolGetRecentTrades(supabase, userId, args);
  if (name === "get_copier_logs") return await toolGetCopierLogs(supabase, userId, args);
  return null;
}
