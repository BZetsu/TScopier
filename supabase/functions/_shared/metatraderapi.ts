/**
 * Minimal MetatraderAPI (metatraderapi.dev) client for the Deno edge runtime.
 * All endpoints are GET with query parameters per
 * https://docs.metatraderapi.dev/docs/metatrader-5-api.
 */

const DEFAULT_BASE_URL = "https://api.metatraderapi.dev"

export type MtPlatform = "MT4" | "MT5"

export interface AccountSummary {
  balance?: number
  credit?: number
  profit?: number
  equity?: number
  margin?: number
  freeMargin?: number
  marginLevel?: number
  leverage?: number
  currency?: string
  type?: string
  isInvestor?: boolean
}

export interface RegisterAccountResult {
  id: string
  message?: string
}

export class MetatraderApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "MetatraderApiError"
    this.status = status
    this.code = code
  }
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    out.set(k, String(v))
  }
  return out.toString()
}

export class MetatraderApiClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    if (!apiKey) throw new Error("MetatraderApiClient: apiKey is required")
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined | null>): Promise<T> {
    const qs = buildQuery(params)
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": this.apiKey, accept: "application/json" },
    })
    const text = await res.text()
    let body: unknown = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = text }
    }
    if (!res.ok) {
      const msg = (body && typeof body === "object" && "message" in (body as Record<string, unknown>))
        ? String((body as Record<string, unknown>).message)
        : (body && typeof body === "object" && "error" in (body as Record<string, unknown>))
          ? String((body as Record<string, unknown>).error)
          : text || `HTTP ${res.status}`
      const code = (body && typeof body === "object" && "code" in (body as Record<string, unknown>))
        ? String((body as Record<string, unknown>).code)
        : undefined
      throw new MetatraderApiError(msg, res.status, code)
    }
    return body as T
  }

  registerAccount(args: {
    platform: MtPlatform
    server: string
    login: string
    password: string
    name?: string
  }): Promise<RegisterAccountResult> {
    return this.get<RegisterAccountResult>("/RegisterAccount", {
      type: args.platform === "MT5" ? "Metatrader 5" : "Metatrader 4",
      server: args.server,
      user: args.login,
      password: args.password,
      name: args.name,
    })
  }

  deleteAccount(id: string): Promise<{ message?: string }> {
    return this.get<{ message?: string }>("/DeleteAccount", { id })
  }

  checkConnect(id: string): Promise<string> {
    return this.get<string>("/CheckConnect", { id })
  }

  accountSummary(id: string): Promise<AccountSummary> {
    return this.get<AccountSummary>("/AccountSummary", { id })
  }

  /** Market + pending orders currently open on the account (see docs: GET /OpenedOrders). */
  openedOrders(id: string): Promise<unknown[]> {
    return this.get<unknown[]>("/OpenedOrders", { id })
  }

  /** Last 100 closed orders from the current MT session (see docs: GET /ClosedOrders). */
  closedOrders(id: string): Promise<unknown[]> {
    return this.get<unknown[]>("/ClosedOrders", { id })
  }
}

export function makeClientFromEnv(env: { get(name: string): string | undefined }): MetatraderApiClient {
  const apiKey = env.get("METATRADERAPI_KEY") ?? ""
  const baseUrl = env.get("METATRADERAPI_BASE_URL") ?? DEFAULT_BASE_URL
  return new MetatraderApiClient(apiKey, baseUrl)
}
