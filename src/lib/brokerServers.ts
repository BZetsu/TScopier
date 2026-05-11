import { supabase } from './supabase'
import type { MtServer } from '../types/database'
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

/**
 * Load broker servers from `mt_servers`, filtered by platform and grouped by
 * broker name. The DB already stores a backfilled `broker_label`; we fall back
 * to inferBrokerLabelFromServer for any row that hasn't been labeled yet so the
 * typeahead remains useful even on fresh installs.
 */
export async function loadBrokerServers(platform: 'MT4' | 'MT5'): Promise<BrokerServerGroup[]> {
  const { data, error } = await supabase
    .from('mt_servers')
    .select('id,server_name,platform,broker_label,is_active')
    .eq('is_active', true)
    .in('platform', [platform, 'ANY'])
    .order('server_name', { ascending: true })
    .limit(2000)

  if (error) throw new Error(error.message)

  const groups = new Map<string, ServerOption[]>()
  for (const row of (data ?? []) as MtServer[]) {
    const label = (row.broker_label && row.broker_label.trim())
      || inferBrokerLabelFromServer(row.server_name)
      || 'Other'
    const arr = groups.get(label) ?? []
    arr.push({ id: row.id, server_name: row.server_name, broker_label: label })
    groups.set(label, arr)
  }

  return [...groups.entries()]
    .map(([broker_label, servers]) => ({ broker_label, servers }))
    .sort((a, b) => a.broker_label.localeCompare(b.broker_label))
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
