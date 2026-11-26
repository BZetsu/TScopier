/**
 * Environment-neutral broker connection status rules.
 *
 * The browser and Edge Functions use the same resolver so assistant answers and
 * Account Configuration cannot describe one broker differently. This module
 * only interprets persisted status fields; it never reads or writes a session.
 */

export type BrokerConnectionStatusAccount = {
  provider?: string | null;
  connection_status?: string | null;
  fxsocket_status?: string | null;
  mtapi_status?: string | null;
  ctrader_status?: string | null;
  binance_status?: string | null;
  bybit_status?: string | null;
  kucoin_status?: string | null;
  dxtrade_status?: string | null;
  tradelocker_status?: string | null;
  matchtrader_status?: string | null;
  terminal_connected?: boolean | null;
  trade_allowed?: boolean | null;
  live_terminal_health_phase?:
    | "healthy"
    | "unhealthy"
    | "checking"
    | "paused"
    | null;
};

function normalizedStatus(value: unknown): string | null {
  const status = String(value ?? "").trim().toLowerCase();
  return status || null;
}

function providerStatus(account: BrokerConnectionStatusAccount): string | null {
  const provider = String(account.provider ?? "fxsocket").trim().toLowerCase();
  switch (provider) {
    case "mtapi":
      return normalizedStatus(account.mtapi_status);
    case "ctrader":
      return normalizedStatus(account.ctrader_status);
    case "binance":
      return normalizedStatus(account.binance_status);
    case "bybit":
      return normalizedStatus(account.bybit_status);
    case "kucoin":
      return normalizedStatus(account.kucoin_status);
    case "dxtrade":
      return normalizedStatus(account.dxtrade_status);
    case "tradelocker":
      return normalizedStatus(account.tradelocker_status);
    case "matchtrader":
      return normalizedStatus(account.matchtrader_status);
    default:
      return normalizedStatus(account.fxsocket_status);
  }
}

/**
 * Resolve the effective connection state.
 *
 * Error and recovering states take precedence. A known-good terminal or a
 * connected provider status is authoritative. A provider error/disconnected
 * state is not hidden by a stale generic `connection_status` value.
 */
export function brokerEffectiveConnectionStatus(
  account: BrokerConnectionStatusAccount,
): string | null {
  const connectionStatus = normalizedStatus(account.connection_status);
  if (connectionStatus === "error") return "error";
  if (connectionStatus === "recovering") return "recovering";

  if (account.live_terminal_health_phase === "healthy") return "connected";
  if (account.terminal_connected === true && account.trade_allowed === true) {
    return "connected";
  }

  const status = providerStatus(account);
  if (status === "connected") return "connected";
  if (connectionStatus === "pending") return "pending";
  if (status) return status;
  if (connectionStatus === "connected" || connectionStatus === "healthy") {
    return "connected";
  }
  return connectionStatus;
}

export function isBrokerSessionHealthy(
  account: BrokerConnectionStatusAccount,
): boolean {
  const status = brokerEffectiveConnectionStatus(account);
  return status === "connected" || status === "connecting" || status === "recovering";
}

export function isBrokerSessionConnected(
  account: BrokerConnectionStatusAccount,
): boolean {
  return brokerEffectiveConnectionStatus(account) === "connected";
}
