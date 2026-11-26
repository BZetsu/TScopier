import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  summarizeAccountContextAccess,
  toolGetAccountContext,
  toolGetRecentTrades,
  toolListBrokers,
} from "./readOnlyTools.ts";

type FakeResult = {
  data: unknown;
  error: { message: string } | null;
};

type FakeChain = PromiseLike<FakeResult> & {
  select: (_columns: string) => FakeChain;
  eq: (_column: string, _value: unknown) => FakeChain;
  order: (_column: string, _options: unknown) => FakeChain;
  limit: (_count: number) => FakeChain;
  maybeSingle: () => Promise<FakeResult>;
};

function fakeClient(
  tableData: Record<string, unknown>,
  tableErrors: Record<string, { message: string }> = {},
) {
  const scopes: Record<string, Array<[string, unknown]>> = {};

  return {
    client: {
      from(table: string) {
        const chain = {} as FakeChain;
        const result = (): FakeResult => ({
          data: tableData[table] ?? null,
          error: tableErrors[table] ?? null,
        });
        chain.select = () => chain;
        chain.eq = (column: string, value: unknown) => {
          const tableScopes = scopes[table] ?? [];
          tableScopes.push([column, value]);
          scopes[table] = tableScopes;
          return chain;
        };
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () => Promise.resolve(result());
        chain.then = <TResult1 = FakeResult, TResult2 = never>(
          onfulfilled?:
            | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ): PromiseLike<TResult1 | TResult2> =>
          Promise.resolve(result()).then(onfulfilled, onrejected);
        return chain;
      },
      auth: {
        admin: {
          getUserById: () => Promise.resolve({ data: null, error: null }),
        },
      },
    },
    scopes,
  };
}

Deno.test("setup status reads the effective plan and access type from account context", () => {
  assertEquals(
    summarizeAccountContextAccess({
      subscription: {
        plan: "basic",
        status: "active",
        effective_plan: "basic",
        access: "active",
      },
    }),
    { effective_plan: "basic", access: "active" },
  );
  assertEquals(
    summarizeAccountContextAccess({
      subscription: {
        plan: "basic",
        status: "canceled",
        effective_plan: "advanced",
        access: "extension",
      },
    }),
    { effective_plan: "advanced", access: "extension" },
  );
});

Deno.test("account context returns the authenticated customer's plan, limits and setup", async () => {
  const fake = fakeClient({
    subscriptions: {
      plan: "basic",
      status: "active",
      extra_accounts: 0,
      trial_ends_at: null,
      current_period_end: null,
    },
    user_profiles: null,
    telegram_channels: [
      {
        id: "channel-1",
        display_name: "Gold Signals",
        channel_username: "gold_signals",
        is_active: true,
        source_kind: "telegram",
      },
      {
        id: "channel-2",
        display_name: "FX Signals",
        channel_username: "fx_signals",
        is_active: true,
        source_kind: "telegram",
      },
      {
        id: "channel-3",
        display_name: "Alert Webhook",
        channel_username: null,
        is_active: true,
        source_kind: "tradingview",
      },
      {
        id: "channel-4",
        display_name: "Discord Signals",
        channel_username: null,
        is_active: true,
        source_kind: "discord",
      },
      {
        id: "channel-5",
        display_name: "WhatsApp Signals",
        channel_username: null,
        is_active: true,
        source_kind: "whatsapp",
      },
      {
        id: "channel-6",
        display_name: "Paused Telegram Signals",
        channel_username: "paused_signals",
        is_active: false,
        source_kind: "telegram",
      },
    ],
    broker_accounts: [
      {
        id: "broker-1",
        label: "Deriv MT5",
        account_login: "12345",
        platform: "MT5",
        is_active: true,
        provider: "mtapi",
        connection_status: "connected",
        mtapi_status: "connected",
        mtapi_session_id: "session-present",
        fxsocket_account_id: null,
        broker_server: "Deriv",
        broker_name: null,
      },
      {
        id: "broker-2",
        label: "Paused MT5",
        account_login: "67890",
        platform: "MT5",
        is_active: false,
        provider: "mtapi",
        connection_status: "connected",
        mtapi_status: "connected",
        mtapi_session_id: "session-present-2",
        fxsocket_account_id: null,
        broker_server: "Paused Server",
        broker_name: null,
      },
      {
        id: "broker-3",
        label: "Disconnected MT5",
        account_login: "24680",
        platform: "MT5",
        is_active: true,
        provider: "mtapi",
        connection_status: "disconnected",
        mtapi_status: "disconnected",
        mtapi_session_id: "stale-session",
        fxsocket_account_id: null,
        broker_server: "Disconnected Server",
        broker_name: null,
      },
    ],
  });

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(payload.subscription, {
    plan: "basic",
    status: "active",
    effective_plan: "basic",
    access: "active",
    trial_ends_at: null,
    current_period_end: null,
    extra_accounts: 0,
  });
  assertEquals(payload.limits, {
    source: "basic",
    max_broker_accounts: 1,
    max_telegram_channels: 5,
    max_backtests_per_month: 5,
    max_tp_rows: 3,
  });
  assertEquals(payload.usage, {
    channels_total: 6,
    channels_active: 5,
    telegram_channels_total: 3,
    telegram_channels_active: 2,
    reported_active_telegram_count_within_limit: true,
    brokers_total: 3,
    brokers_active: 2,
    brokers_connected: 1,
    brokers_connected_total: 2,
  });
  assertEquals(payload.channels, [
    {
      name: "Gold Signals",
      username: "gold_signals",
      source: "telegram",
      active: true,
      is_telegram_source: true,
      consumes_telegram_slot: true,
      counts_toward_telegram_limit: true,
    },
    {
      name: "FX Signals",
      username: "fx_signals",
      source: "telegram",
      active: true,
      is_telegram_source: true,
      consumes_telegram_slot: true,
      counts_toward_telegram_limit: true,
    },
    {
      name: "Alert Webhook",
      username: null,
      source: "tradingview",
      active: true,
      is_telegram_source: false,
      consumes_telegram_slot: false,
      counts_toward_telegram_limit: false,
    },
    {
      name: "Discord Signals",
      username: null,
      source: "discord",
      active: true,
      is_telegram_source: false,
      consumes_telegram_slot: false,
      counts_toward_telegram_limit: false,
    },
    {
      name: "WhatsApp Signals",
      username: null,
      source: "whatsapp",
      active: true,
      is_telegram_source: false,
      consumes_telegram_slot: false,
      counts_toward_telegram_limit: false,
    },
    {
      name: "Paused Telegram Signals",
      username: "paused_signals",
      source: "telegram",
      active: false,
      is_telegram_source: true,
      consumes_telegram_slot: false,
      counts_toward_telegram_limit: false,
    },
  ]);
  assertEquals(payload.brokers, [
    {
      label: "Deriv MT5",
      platform: "MT5",
      provider: "mtapi",
      is_active: true,
      copying: true,
      connected: true,
      connection_status: "connected",
    },
    {
      label: "Paused MT5",
      platform: "MT5",
      provider: "mtapi",
      is_active: false,
      copying: false,
      connected: true,
      connection_status: "connected",
    },
    {
      label: "Disconnected MT5",
      platform: "MT5",
      provider: "mtapi",
      is_active: true,
      copying: true,
      connected: false,
      connection_status: "disconnected",
    },
  ]);

  const serialized = result.content;
  assertEquals(serialized.includes("customer-1"), false);
  assertEquals(serialized.includes("channel-1"), false);
  assertEquals(serialized.includes("channel-2"), false);
  assertEquals(serialized.includes("channel-3"), false);
  assertEquals(serialized.includes("channel-4"), false);
  assertEquals(serialized.includes("channel-5"), false);
  assertEquals(serialized.includes("channel-6"), false);
  assertEquals(serialized.includes("broker-1"), false);
  assertEquals(serialized.includes("broker-2"), false);
  assertEquals(serialized.includes("broker-3"), false);
  assertEquals(serialized.includes("session-present"), false);
  assertEquals(serialized.includes("stale-session"), false);
  assertEquals(serialized.includes("12345"), false);
  assertEquals(serialized.includes("67890"), false);
  assertEquals(serialized.includes("24680"), false);
  assertEquals(serialized.includes('"account_login"'), false);
  assertEquals(serialized.includes('"broker_server"'), false);
  assertEquals(serialized.includes("Paused Server"), false);
  assertEquals(serialized.includes("Disconnected Server"), false);

  for (const [table, filters] of Object.entries(fake.scopes)) {
    assert(filters.length > 0, `${table} should be scoped`);
    for (const [column, value] of filters) {
      assertEquals(column, "user_id");
      assertEquals(value, "customer-1");
    }
  }
});

Deno.test("broker list omits internal IDs, login IDs, server names, and session values", async () => {
  const fake = fakeClient({
    broker_accounts: [
      {
        id: "broker-private-id",
        label: "Live MT5",
        account_login: "998877",
        platform: "MT5",
        is_active: true,
        provider: "mtapi",
        connection_status: "connected",
        mtapi_status: "connected",
        mtapi_session_id: "provider-session-private",
        broker_server: "Private Server",
        broker_name: null,
      },
    ],
  });

  const result = await toolListBrokers(fake.client as never, "customer-1");
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(payload.brokers, [
    {
      label: "Live MT5",
      platform: "MT5",
      provider: "mtapi",
      is_active: true,
      copying: true,
      connected: true,
      connection_status: "connected",
    },
  ]);
  assertEquals(result.content.includes("broker-private-id"), false);
  assertEquals(result.content.includes("998877"), false);
  assertEquals(result.content.includes("provider-session-private"), false);
  assertEquals(result.content.includes("Private Server"), false);
  assertEquals(result.content.includes('"account_login"'), false);
  assertEquals(result.content.includes('"broker_server"'), false);

  for (const [table, filters] of Object.entries(fake.scopes)) {
    assertEquals(table, "broker_accounts");
    assertEquals(filters, [["user_id", "customer-1"]]);
  }
});

Deno.test("recent trades omit internal signal and broker IDs", async () => {
  const fake = fakeClient({
    trades: [
      {
        symbol: "XAUUSD",
        direction: "buy",
        lot_size: 0.1,
        status: "open",
        opened_at: "2026-11-25T10:00:00Z",
        closed_at: null,
        profit: null,
        close_reason: null,
        broker_position_ticket: "broker-ticket-123",
        broker_account_id: "internal-broker-id",
        signal_id: "internal-signal-id",
        created_at: "2026-11-25T10:00:01Z",
      },
    ],
  });

  const result = await toolGetRecentTrades(
    fake.client as never,
    "customer-1",
    { limit: 5 },
  );
  const payload = JSON.parse(result.content) as {
    trades: Array<Record<string, unknown>>;
  };

  assertEquals(payload.trades[0]?.ticket, "broker-ticket-123");
  assertEquals(result.content.includes("internal-broker-id"), false);
  assertEquals(result.content.includes("internal-signal-id"), false);
  assertEquals(result.content.includes('"broker_account_id"'), false);
  assertEquals(result.content.includes('"signal_id"'), false);
  assertEquals(fake.scopes.trades, [["user_id", "customer-1"]]);
});

const ACTIVE_BASIC_SUBSCRIPTION = {
  plan: "basic",
  status: "active",
  extra_accounts: 0,
  trial_ends_at: null,
  current_period_end: null,
};

Deno.test("account context returns an explicit error when the subscription read fails", async () => {
  const fake = fakeClient(
    {
      subscriptions: ACTIVE_BASIC_SUBSCRIPTION,
      user_profiles: null,
      telegram_channels: [],
      broker_accounts: [],
    },
    { subscriptions: { message: "database unavailable" } },
  );

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(
    payload.error,
    "Unable to verify account state. Please try again.",
  );
  assertEquals(payload.usage, undefined);
  assertEquals(payload.subscription, undefined);
});

Deno.test("account context returns an explicit error when a channel read fails", async () => {
  const fake = fakeClient(
    {
      subscriptions: ACTIVE_BASIC_SUBSCRIPTION,
      user_profiles: null,
      telegram_channels: [],
      broker_accounts: [],
    },
    { telegram_channels: { message: "database unavailable" } },
  );

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(
    payload.error,
    "Unable to verify account state. Please try again.",
  );
  assertEquals(payload.usage, undefined);
});

Deno.test("account context returns an explicit error when a broker read fails", async () => {
  const fake = fakeClient(
    {
      subscriptions: ACTIVE_BASIC_SUBSCRIPTION,
      user_profiles: null,
      telegram_channels: [],
      broker_accounts: [],
    },
    { broker_accounts: { message: "database unavailable" } },
  );

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(
    payload.error,
    "Unable to verify account state. Please try again.",
  );
  assertEquals(payload.usage, undefined);
});

Deno.test("account context returns an explicit error when admin access cannot be verified", async () => {
  const fake = fakeClient(
    {
      subscriptions: ACTIVE_BASIC_SUBSCRIPTION,
      user_profiles: null,
      telegram_channels: [],
      broker_accounts: [],
    },
    { user_profiles: { message: "database unavailable" } },
  );

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(
    payload.error,
    "Unable to verify account state. Please try again.",
  );
  assertEquals(payload.usage, undefined);
});

Deno.test("account context returns an explicit error when an extension read fails", async () => {
  const fake = fakeClient(
    {
      subscriptions: {
        ...ACTIVE_BASIC_SUBSCRIPTION,
        status: "canceled",
      },
      user_profiles: null,
      telegram_channels: [],
      broker_accounts: [],
    },
    { subscription_extensions: { message: "database unavailable" } },
  );

  const result = await toolGetAccountContext(
    fake.client as never,
    "customer-1",
  );
  const payload = JSON.parse(result.content) as Record<string, unknown>;

  assertEquals(
    payload.error,
    "Unable to verify account state. Please try again.",
  );
  assertEquals(payload.usage, undefined);
  assertEquals(payload.subscription, undefined);
});
