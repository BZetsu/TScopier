import { assertEquals } from "jsr:@std/assert@1";
import {
  brokerEffectiveConnectionStatus,
  isBrokerSessionConnected,
  isBrokerSessionHealthy,
} from "./brokerConnectionStatus.ts";

Deno.test("broker status gives an account error precedence over a connected provider", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "fxsocket",
      connection_status: "error",
      fxsocket_status: "connected",
    }),
    "error",
  );
});

Deno.test("broker status gives a recovering account precedence over a connected provider", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "mtapi",
      connection_status: "recovering",
      mtapi_status: "connected",
    }),
    "recovering",
  );
});

Deno.test("broker status accepts a healthy terminal even while the generic state is pending", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "fxsocket",
      connection_status: "pending",
      terminal_connected: true,
      trade_allowed: true,
    }),
    "connected",
  );
});

Deno.test("broker status accepts a healthy live terminal phase", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "fxsocket",
      connection_status: "pending",
      live_terminal_health_phase: "healthy",
    }),
    "connected",
  );
});

Deno.test("broker status uses the active provider status", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "ctrader",
      connection_status: null,
      ctrader_status: "connected",
      fxsocket_status: "disconnected",
    }),
    "connected",
  );
});

Deno.test("broker status does not let a generic connected value hide a provider error", () => {
  assertEquals(
    brokerEffectiveConnectionStatus({
      provider: "fxsocket",
      connection_status: "connected",
      fxsocket_status: "error",
    }),
    "error",
  );
});

Deno.test("broker status does not treat a session identifier as proof of a live connection", () => {
  const staleSession = {
    provider: "mtapi",
    connection_status: "disconnected",
    mtapi_status: "disconnected",
    mtapi_session_id: "session-present",
  };
  assertEquals(isBrokerSessionConnected(staleSession), false);
});

Deno.test("broker status distinguishes connected, healthy and disconnected states", () => {
  const connected = { provider: "fxsocket", fxsocket_status: "connected" };
  const recovering = { provider: "fxsocket", connection_status: "recovering" };
  const disconnected = { provider: "fxsocket", fxsocket_status: "disconnected" };

  assertEquals(isBrokerSessionConnected(connected), true);
  assertEquals(isBrokerSessionHealthy(connected), true);
  assertEquals(isBrokerSessionHealthy(recovering), true);
  assertEquals(isBrokerSessionHealthy(disconnected), false);
});
