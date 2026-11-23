/**
 * Outcome recorded for a Telegram auth action (send code, reconnect, …).
 *
 * The admin user page shows these events so support can explain what a customer
 * did. The event used to be written *before* the request reached the worker, so
 * "Reconnected the Telegram listener from the app" appeared even when the worker
 * rejected the call (for example with `wrong_shard`) — support read that as a
 * successful reconnect. Every action event now carries the real outcome.
 */
export type AuthActionOutcome = {
  /** True only when the worker accepted the action and reported no error. */
  ok: boolean
  /** HTTP status returned by the worker, when a response was received. */
  status?: number
  /** Machine-readable worker reason, e.g. `wrong_shard`. */
  reason?: string | null
  /** Client-safe error text returned by the worker or the proxy itself. */
  error?: string | null
}

/**
 * Classify a worker response into the outcome recorded for support.
 *
 * Kept separate from the edge handler so the rules are testable: a worker can
 * answer HTTP 200 with `{ ok: false, reason: "wrong_shard" }`, and that must
 * never be read as success.
 */
export function classifyAuthActionOutcome(
  status: number,
  responseOk: boolean,
  payload: unknown,
): AuthActionOutcome {
  const rec = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined
  const error = typeof rec?.error === "string" ? rec.error : null
  const reason = typeof rec?.reason === "string" ? rec.reason : null
  // verify_code can be accepted and still require the account's 2FA password.
  // The action succeeded, but the admin page must not report it as a finished link.
  const requiresPassword = rec?.requires_password === true

  return {
    ok: responseOk && rec?.ok !== false && !error,
    status,
    reason: requiresPassword ? "requires_password" : reason,
    error,
  }
}

/**
 * Strip worker hostnames from proxy error text before it is persisted.
 *
 * `listener_events` rows are readable by their owner under RLS, so a raw Deno
 * connect error ("error sending request for url (https://listener-shard-…)" )
 * would show a customer our internal shard URLs.
 */
export function redactWorkerUrls(text: string): string {
  return String(text ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, "<worker>")
    .slice(0, 200)
}

export type AuthActionDetailInput = {
  action: string
  clientId?: string | null
  ip?: string | null
  ua?: string | null
  outcome: AuthActionOutcome
}

/**
 * Build the `detail` payload for a `telegram_auth_action` event.
 *
 * Kept pure so the shape is testable without a database: the admin page and the
 * support scripts both read these fields, and an `ok` that is absent must never
 * be mistaken for success.
 */
export function buildAuthActionDetail(input: AuthActionDetailInput): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    action: input.action,
    client: input.clientId || "-",
    ip: input.ip || null,
    ua: input.ua || null,
    ok: input.outcome.ok === true,
  }

  if (typeof input.outcome.status === "number" && Number.isFinite(input.outcome.status)) {
    detail.status = input.outcome.status
  }

  const reason = typeof input.outcome.reason === "string" ? input.outcome.reason.trim() : ""
  if (reason) detail.reason = reason

  const error = typeof input.outcome.error === "string" ? input.outcome.error.trim() : ""
  if (error) detail.error = error

  return detail
}
