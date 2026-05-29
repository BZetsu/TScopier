import type { Json, ManualSettings } from '../types/database'
import { DEFAULT_MANUAL_SETTINGS } from './defaultManualSettings'
import { normalizeSignalChannelIds } from './brokerChannelLink'

export interface ChannelTradingConfig {
  copier_mode?: 'ai' | 'manual'
  manual_settings?: ManualSettings | null
  ai_settings?: Json | null
}

export type ChannelTradingConfigsMap = Record<string, ChannelTradingConfig>

export type BrokerChannelTradingFields = {
  copier_mode?: 'ai' | 'manual' | null
  manual_settings?: Json | null
  ai_settings?: Json | null
  channel_trading_configs?: Json | null
  signal_channel_ids?: string[] | null
}

export type ChannelConfigSource = 'per_channel' | 'broker_fallback' | 'unlinked'

export type ChannelConfigReadyResult =
  | { ready: true; source: ChannelConfigSource }
  | { ready: false; reason: 'channel_config_missing' | 'channel_config_incomplete'; channelId: string }

export function normalizeChannelTradingConfigsMap(raw: unknown): ChannelTradingConfigsMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ChannelTradingConfigsMap = {}
  for (const [channelId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!channelId.trim() || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    const mode = row.copier_mode
    out[channelId] = {
      copier_mode: mode === 'ai' || mode === 'manual' ? mode : undefined,
      manual_settings: row.manual_settings && typeof row.manual_settings === 'object'
        ? (row.manual_settings as ManualSettings)
        : undefined,
      ai_settings: (row.ai_settings ?? undefined) as Json | undefined,
    }
  }
  return out
}

export function buildDefaultChannelTradingConfig(): ChannelTradingConfig {
  return {
    copier_mode: 'manual',
    manual_settings: JSON.parse(JSON.stringify(DEFAULT_MANUAL_SETTINGS)) as ManualSettings,
    ai_settings: {} as Json,
  }
}

export function channelManualSettingsComplete(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const ms = raw as Record<string, unknown>
  const lot = Number(ms.fixed_lot)
  const style = ms.trade_style
  return Number.isFinite(lot) && lot > 0 && (style === 'single' || style === 'multi')
}

export function storedPerChannelConfigComplete(
  configs: ChannelTradingConfigsMap,
  channelId: string,
): boolean {
  const entry = configs[channelId]
  if (!entry) return false
  return channelManualSettingsComplete(entry.manual_settings)
}

export function channelConfigReadyForExecution(
  broker: BrokerChannelTradingFields,
  channelId: string | null | undefined,
): ChannelConfigReadyResult {
  if (!channelId) {
    return { ready: true, source: 'unlinked' }
  }
  const linked = normalizeSignalChannelIds(broker.signal_channel_ids)
  if (!linked.includes(channelId)) {
    return { ready: true, source: 'unlinked' }
  }
  const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs)
  const entry = configs[channelId]
  if (!entry) {
    return { ready: false, reason: 'channel_config_missing', channelId }
  }
  if (!channelManualSettingsComplete(entry.manual_settings)) {
    return { ready: false, reason: 'channel_config_incomplete', channelId }
  }
  return { ready: true, source: 'per_channel' }
}

export function resolveChannelTradingConfig(
  broker: BrokerChannelTradingFields,
  channelId: string | null | undefined,
): {
  copier_mode: 'ai' | 'manual'
  manual_settings: ManualSettings
  ai_settings: Json
  config_source: ChannelConfigSource
} {
  const fallbackMode = (broker.copier_mode ?? 'manual') as 'ai' | 'manual'
  const fallbackManual = (broker.manual_settings && typeof broker.manual_settings === 'object'
    ? broker.manual_settings
    : DEFAULT_MANUAL_SETTINGS) as ManualSettings
  const fallbackAi = (broker.ai_settings ?? {}) as Json

  if (!channelId) {
    return {
      copier_mode: fallbackMode,
      manual_settings: fallbackManual,
      ai_settings: fallbackAi,
      config_source: 'unlinked',
    }
  }

  const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs)
  const channelConfig = configs[channelId]
  const ready = channelConfigReadyForExecution(broker, channelId)

  if (ready.ready && ready.source === 'per_channel' && channelConfig?.manual_settings) {
    return {
      copier_mode: channelConfig.copier_mode ?? fallbackMode,
      manual_settings: channelConfig.manual_settings as ManualSettings,
      ai_settings: (channelConfig.ai_settings ?? fallbackAi) as Json,
      config_source: 'per_channel',
    }
  }

  if (ready.ready && ready.source === 'unlinked') {
    return {
      copier_mode: fallbackMode,
      manual_settings: fallbackManual,
      ai_settings: fallbackAi,
      config_source: 'broker_fallback',
    }
  }

  return {
    copier_mode: fallbackMode,
    manual_settings: fallbackManual,
    ai_settings: fallbackAi,
    config_source: 'broker_fallback',
  }
}

export function cloneChannelTradingConfig(from: ChannelTradingConfig): ChannelTradingConfig {
  return {
    copier_mode: from.copier_mode ?? 'manual',
    manual_settings: from.manual_settings
      ? (JSON.parse(JSON.stringify(from.manual_settings)) as ManualSettings)
      : (JSON.parse(JSON.stringify(DEFAULT_MANUAL_SETTINGS)) as ManualSettings),
    ai_settings: from.ai_settings
      ? JSON.parse(JSON.stringify(from.ai_settings))
      : ({} as Json),
  }
}

export function removeChannelTradingConfigKey(
  configs: ChannelTradingConfigsMap,
  channelId: string,
): ChannelTradingConfigsMap {
  const next = { ...configs }
  delete next[channelId]
  return next
}

export function buildChannelTradingConfigsFromDraft(
  channelIds: string[],
  draftConfigs: Record<string, { mode: 'ai' | 'manual'; manualSettings: ManualSettings }>,
): ChannelTradingConfigsMap {
  const out: ChannelTradingConfigsMap = {}
  for (const channelId of channelIds) {
    const draft = draftConfigs[channelId]
    if (!draft) continue
    out[channelId] = {
      copier_mode: draft.mode,
      manual_settings: {
        ...draft.manualSettings,
        allow_high_impact_news: draft.manualSettings.news_trading_enabled === true,
      },
      ai_settings: {} as Json,
    }
  }
  return out
}
