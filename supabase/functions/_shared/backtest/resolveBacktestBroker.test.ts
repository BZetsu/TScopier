import { assertEquals, assertRejects } from "jsr:@std/assert"
import { resolveBrokerSymbol } from "./fxsocketMarketData.ts"
import {
  BacktestBrokerNotFoundError,
  BacktestSymbolNotFoundError,
  resolveBacktestBroker,
} from "./resolveBacktestBroker.ts"
import type { FxsocketClient } from "../fxsocketClient.ts"

Deno.test("resolveBacktestBroker throws when user has no linked brokers", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  const fx = { symbols: async () => [] } as unknown as FxsocketClient

  await assertRejects(
    async () => {
      await resolveBacktestBroker(supabase as never, fx, "user-1", "EURUSD")
    },
    BacktestBrokerNotFoundError,
    "Connect an MT4/MT5 broker",
  )
})

Deno.test("resolveBacktestBroker picks broker with matching symbol", async () => {
  const brokerRow = {
    id: "broker-uuid",
    label: "Demo IC",
    platform: "MT5",
    fxsocket_account_id: "11111111-2222-3333-4444-555555555555",
    fxsocket_status: "connected",
    connection_status: "connected",
    is_active: true,
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [brokerRow], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  const fx = {
    symbols: async () => ["EURUSD.sd", "GBPUSD.sd"],
  } as unknown as FxsocketClient

  const ctx = await resolveBacktestBroker(supabase as never, fx, "user-1", "EURUSD")
  assertEquals(ctx.brokerAccountId, "broker-uuid")
  assertEquals(ctx.fxsocketAccountId, "11111111-2222-3333-4444-555555555555")
  assertEquals(ctx.platform, "MT5")
  assertEquals(resolveBrokerSymbol("EURUSD", ctx.brokerSymbols), "EURUSD.sd")
})

Deno.test("resolveBacktestBroker passes MT4 platform to symbols API", async () => {
  const brokerRow = {
    id: "broker-uuid",
    label: "HFM Live",
    platform: "MT4",
    fxsocket_account_id: "11111111-2222-3333-4444-555555555555",
    fxsocket_status: "connected",
    connection_status: "connected",
    is_active: true,
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [brokerRow], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  let seenPlatform: string | null | undefined
  const fx = {
    symbols: async (_accountId: string, platform?: string | null) => {
      seenPlatform = platform
      return ["GOLD", "EURUSD"]
    },
  } as unknown as FxsocketClient

  const ctx = await resolveBacktestBroker(supabase as never, fx, "user-1", "XAUUSD")
  assertEquals(seenPlatform, "MT4")
  assertEquals(ctx.platform, "MT4")
  assertEquals(resolveBrokerSymbol("XAUUSD", ctx.brokerSymbols), "GOLD")
})

Deno.test("resolveBacktestBroker throws when symbol missing on all brokers", async () => {
  const brokerRow = {
    id: "broker-uuid",
    label: "Demo",
    platform: "MT5",
    fxsocket_account_id: "11111111-2222-3333-4444-555555555555",
    fxsocket_status: "connected",
    connection_status: "connected",
    is_active: true,
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [brokerRow], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  const fx = {
    symbols: async () => ["GBPUSD.sd"],
  } as unknown as FxsocketClient

  await assertRejects(
    async () => {
      await resolveBacktestBroker(supabase as never, fx, "user-1", "XAUUSD")
    },
    BacktestSymbolNotFoundError,
  )
})

Deno.test("resolveBacktestBroker maps XAUUSD to GOLD on broker watchlist", async () => {
  const brokerRow = {
    id: "broker-uuid",
    label: "HFM Demo",
    platform: "MT4",
    fxsocket_account_id: "11111111-2222-3333-4444-555555555555",
    fxsocket_status: "connected",
    connection_status: "connected",
    is_active: true,
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [brokerRow], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  const fx = {
    symbols: async () => ["GOLD", "EURUSD"],
  } as unknown as FxsocketClient

  const ctx = await resolveBacktestBroker(supabase as never, fx, "user-1", "XAUUSD")
  assertEquals(ctx.brokerAccountId, "broker-uuid")
  assertEquals(resolveBrokerSymbol("XAUUSD", ctx.brokerSymbols), "GOLD")
})

Deno.test("resolveBacktestBroker surfaces symbols API failure distinctly", async () => {
  const brokerRow = {
    id: "broker-uuid",
    label: "Demo",
    platform: "MT4",
    fxsocket_account_id: "11111111-2222-3333-4444-555555555555",
    fxsocket_status: "connected",
    connection_status: "connected",
    is_active: true,
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              order: async () => ({ data: [brokerRow], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  const fx = {
    symbols: async () => {
      throw new Error("session down")
    },
  } as unknown as FxsocketClient

  await assertRejects(
    async () => {
      await resolveBacktestBroker(supabase as never, fx, "user-1", "XAUUSD")
    },
    BacktestBrokerNotFoundError,
    "Could not load Market Watch symbols",
  )
})
