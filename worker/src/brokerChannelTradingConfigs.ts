import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type ChannelTradingConfigsMap,
  normalizeChannelTradingConfigsMap,
  normalizeChannelUuid,
} from './channelTradingConfig'

export interface BrokerChannelTradingConfigRow {
  broker_account_id: string
  channel_id: string
  copier_mode: 'ai' | 'manual' | string
  manual_settings: Record<string, unknown>
  ai_settings: Record<string, unknown>
}

const BROKER_CHANNEL_TRADING_CONFIG_SELECT =
  'broker_account_id,channel_id,copier_mode,manual_settings,ai_settings'

function ensurePersistedManualSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const schemaVersion = Number(settings.schema_version ?? 1)
  return {
    ...settings,
    schema_version: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
  }
}

export function channelTradingConfigsMapFromRows(
  rows: BrokerChannelTradingConfigRow[],
): ChannelTradingConfigsMap {
  const out: ChannelTradingConfigsMap = {}
  for (const row of rows) {
    const key = normalizeChannelUuid(row.channel_id)
    if (!key) continue
    out[key] = {
      copier_mode: row.copier_mode === 'ai' ? 'ai' : 'manual',
      manual_settings: ensurePersistedManualSettings(
        row.manual_settings && typeof row.manual_settings === 'object'
          ? row.manual_settings
          : {},
      ),
      ai_settings: row.ai_settings && typeof row.ai_settings === 'object' ? row.ai_settings : {},
    }
  }
  return out
}

export function mergeChannelTradingConfigsFromTable(
  jsonbConfigs: unknown,
  tableRows: BrokerChannelTradingConfigRow[],
): Record<string, unknown> {
  const fromTable = channelTradingConfigsMapFromRows(tableRows)
  const jsonbMap = normalizeChannelTradingConfigsMap(jsonbConfigs)
  return { ...jsonbMap, ...fromTable }
}

export async function fetchBrokerChannelTradingConfigRows(
  supabase: SupabaseClient,
  brokerAccountIds: string[],
): Promise<BrokerChannelTradingConfigRow[]> {
  if (!brokerAccountIds.length) return []
  const { data, error } = await supabase
    .from('broker_channel_trading_configs')
    .select(BROKER_CHANNEL_TRADING_CONFIG_SELECT)
    .in('broker_account_id', brokerAccountIds)

  if (error) {
    console.error('[brokerChannelTradingConfigs] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as BrokerChannelTradingConfigRow[]
}
