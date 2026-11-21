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

export type ToolResult = { content: string };

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function failure(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }) };
}

/** The customer's broker accounts, with a plain answer to "is it connected". */
export async function toolListBrokers(
  supabase: SupabaseClient,
  userId: string,
): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("broker_accounts")
    .select(
      "id,label,account_login,platform,is_active,provider,mtapi_session_id,fxsocket_account_id,broker_server,broker_name",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return failure(error.message);

  return {
    content: JSON.stringify({
      brokers: (data ?? []).map((b) => ({
        label: b.label || b.broker_name || b.account_login || b.id,
        account_login: b.account_login ?? null,
        platform: b.platform,
        is_active: b.is_active,
        copying: b.is_active === true,
        connected:
          b.provider === "mtapi"
            ? Boolean(String(b.mtapi_session_id ?? "").trim())
            : Boolean(String(b.fxsocket_account_id ?? "").trim()),
        broker_server: b.broker_server ?? null,
      })),
      hint: "This is the Account Configuration page. Say plainly which accounts are connected and which are paused; do not invent accounts.",
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
      "symbol,direction,lot_size,status,opened_at,closed_at,profit,close_reason,broker_position_ticket,broker_account_id,signal_id,created_at",
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
        signal_id: t.signal_id,
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
      name: "list_brokers",
      description:
        "List the signed-in customer's broker accounts: label, MT login, platform, whether copying is enabled and whether the connection is live. Use before answering anything about their account setup.",
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
  if (name === "list_brokers") return await toolListBrokers(supabase, userId);
  if (name === "get_recent_trades") return await toolGetRecentTrades(supabase, userId, args);
  if (name === "get_copier_logs") return await toolGetCopierLogs(supabase, userId, args);
  return null;
}
