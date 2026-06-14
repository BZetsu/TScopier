/**
 * FxSocket Broker Search API (BSA).
 * Docs: https://bsa.fxsocket.com/docs
 */

import { FxsocketApiError, resolveFxsocketApiKey } from "./fxsocketClient.ts"

type EnvGetter = { get(name: string): string | undefined }

const DEFAULT_BSA_BASE_URL = "https://bsa.fxsocket.com"

export type BsaPlatformCode = "mt4" | "mt5"

export interface BsaBrokerServer {
  name: string
  logo_url?: string | null
  site?: string | null
  access?: string[]
}

export interface BsaBrokerCompany {
  company: string
  results?: BsaBrokerServer[]
}

export interface BsaSearchResponse {
  result?: BsaBrokerCompany[]
}

export interface BrokerSearchResult {
  name?: string
  access?: string[]
  logoUrl?: string | null
  site?: string | null
}

export interface BrokerSearchCompany {
  companyName?: string
  results?: BrokerSearchResult[]
}

function getBsaBaseUrl(env: EnvGetter): string {
  const raw = (env.get("FXSOCKET_BSA_BASE_URL") ?? "").trim()
  return (raw || DEFAULT_BSA_BASE_URL).replace(/\/+$/, "")
}

export function platformToBsaCode(platform: string): BsaPlatformCode {
  return String(platform).toUpperCase() === "MT4" ? "mt4" : "mt5"
}

export function normalizeBsaSearchResponse(raw: BsaSearchResponse): BrokerSearchCompany[] {
  return (raw.result ?? []).map((row) => ({
    companyName: row.company,
    results: (row.results ?? []).map((server) => ({
      name: server.name,
      access: server.access ?? [],
      logoUrl: server.logo_url ?? null,
      site: server.site ?? null,
    })),
  }))
}

export async function searchBrokerCompanies(
  env: EnvGetter,
  args: { company: string; code?: BsaPlatformCode },
): Promise<BrokerSearchCompany[]> {
  const company = args.company.trim()
  if (company.length < 4) {
    throw new FxsocketApiError("company must be at least 4 characters", 400)
  }

  const code = args.code ?? "mt5"
  const apiKey = resolveFxsocketApiKey(env)
  const url = new URL(`${getBsaBaseUrl(env)}/search`)
  url.searchParams.set("company", company)
  url.searchParams.set("code", code)

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  })

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (!res.ok) {
    const detail = body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
      ? String((body as Record<string, unknown>).detail)
      : text || `HTTP ${res.status}`
    throw new FxsocketApiError(`Broker search failed: ${detail}`, res.status)
  }

  return normalizeBsaSearchResponse((body ?? {}) as BsaSearchResponse)
}
