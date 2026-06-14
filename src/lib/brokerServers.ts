import {
  fxsocketBroker,
  type BrokerSearchCompany,
} from './fxsocketBroker'
import { inferBrokerLabelFromServer } from './brokerFromServer'

export interface ServerOption {
  id: string
  server_name: string
  broker_label: string
}

export interface BrokerServerGroup {
  broker_label: string
  servers: ServerOption[]
}

/** Map FxSocket BSA search results into grouped server options. */
export function brokerSearchToGroups(companies: BrokerSearchCompany[]): BrokerServerGroup[] {
  const groups = new Map<string, ServerOption[]>()

  for (const company of companies) {
    const label = (company.companyName && company.companyName.trim())
      || inferBrokerLabelFromServer(company.results?.[0]?.name ?? '')
      || 'Other'

    for (const result of company.results ?? []) {
      const serverName = (result.name ?? '').trim()
      if (!serverName) continue
      const arr = groups.get(label) ?? []
      arr.push({
        id: `${label}:${serverName}`,
        server_name: serverName,
        broker_label: label,
      })
      groups.set(label, arr)
    }
  }

  return [...groups.entries()]
    .map(([broker_label, servers]) => ({ broker_label, servers }))
    .sort((a, b) => a.broker_label.localeCompare(b.broker_label))
}

/** Search broker companies/servers via FxSocket BSA (proxied through edge). */
export async function searchBrokerServers(
  platform: 'MT4' | 'MT5',
  company: string,
): Promise<BrokerServerGroup[]> {
  const { companies } = await fxsocketBroker.searchBrokers({ platform, company })
  return brokerSearchToGroups(companies)
}

export function flattenBrokerGroups(groups: BrokerServerGroup[]): ServerOption[] {
  return groups.flatMap(g => g.servers)
}

export function filterBrokerGroups(groups: BrokerServerGroup[], query: string): BrokerServerGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  const out: BrokerServerGroup[] = []
  for (const g of groups) {
    const labelMatch = g.broker_label.toLowerCase().includes(q)
    const servers = labelMatch
      ? g.servers
      : g.servers.filter(s => s.server_name.toLowerCase().includes(q))
    if (servers.length) out.push({ broker_label: g.broker_label, servers })
  }
  return out
}
