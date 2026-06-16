import type { BrokerSearchCompany } from './fxsocketBroker'

export interface BrokerServerHit {
  serverName: string
  companyName: string
  company: BrokerSearchCompany
  score: number
}

export interface BrokerSearchPartition {
  serverHits: BrokerServerHit[]
  companyHits: BrokerSearchCompany[]
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function withoutTrailingNumber(value: string): string {
  return value.replace(/\s+\d+$/, '').trim()
}

/** Score how well `text` matches `query` (higher = better). */
export function brokerSearchMatchScore(text: string, query: string): number {
  const haystack = normalizeSearchText(text)
  const needle = normalizeSearchText(query)
  if (!haystack || !needle) return 0
  if (haystack === needle) return 100
  if (haystack.startsWith(needle) || needle.startsWith(haystack)) return 90
  if (haystack.includes(needle) || needle.includes(haystack)) return 75

  const haystackBase = withoutTrailingNumber(haystack)
  const needleBase = withoutTrailingNumber(needle)
  if (haystackBase && needleBase) {
    if (haystackBase === needleBase) return 85
    if (haystackBase.startsWith(needleBase) || needleBase.startsWith(haystackBase)) return 80
    if (haystackBase.includes(needleBase) || needleBase.includes(haystackBase)) return 70
  }

  const tokens = needle.split(/[\s-]+/).filter(token => token.length >= 2)
  if (tokens.length > 0 && tokens.every(token => haystack.includes(token))) {
    return 55 + Math.min(10, tokens.length * 2)
  }

  return 0
}

const SERVER_HIT_MIN_SCORE = 50
const COMPANY_HIT_MIN_SCORE = 45

export function partitionBrokerSearchResults(
  query: string,
  companies: BrokerSearchCompany[],
): BrokerSearchPartition {
  const trimmedQuery = query.trim()
  const isLikelyCompanyQuery = /\s/.test(trimmedQuery) && !trimmedQuery.includes('-')
  const serverHits: BrokerServerHit[] = []
  const seenServers = new Set<string>()

  for (const company of companies) {
    const companyName = (company.companyName ?? '').trim()
    for (const result of company.results ?? []) {
      const serverName = (result.name ?? '').trim()
      if (!serverName) continue
      const key = serverName.toLowerCase()
      if (seenServers.has(key)) continue

      const score = brokerSearchMatchScore(serverName, trimmedQuery)
      if (score < SERVER_HIT_MIN_SCORE) continue
      if (isLikelyCompanyQuery && score < 75) continue

      seenServers.add(key)
      serverHits.push({ serverName, companyName, company, score })
    }
  }

  serverHits.sort((a, b) => b.score - a.score || a.serverName.localeCompare(b.serverName))

  const serverCompanyKeys = new Set(
    serverHits.map(hit => (hit.companyName || '').trim().toLowerCase()).filter(Boolean),
  )

  const companyHits = companies
    .map(company => {
      const companyName = (company.companyName ?? '').trim()
      const score = brokerSearchMatchScore(companyName, trimmedQuery)
      return { company, score }
    })
    .filter(({ company, score }) => {
      const companyName = (company.companyName ?? '').trim()
      const key = companyName.toLowerCase()
      if (!companyName) return false
      if (score < COMPANY_HIT_MIN_SCORE) return false
      if (serverHits.length > 0 && serverCompanyKeys.has(key)) return false
      return true
    })
    .sort((a, b) => b.score - a.score || (a.company.companyName ?? '').localeCompare(b.company.companyName ?? ''))
    .map(({ company }) => company)

  return { serverHits, companyHits }
}
