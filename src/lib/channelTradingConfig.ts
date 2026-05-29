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

export function resolveChannelTradingConfig(
  broker: BrokerChannelTradingFields,
  channelId: string | null | undefined,
): {
  copier_mode: 'ai' | 'manual'
  manual_settings: ManualSettings
  ai_settings: Json
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
    }
  }

  const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs)
  const channelConfig = configs[channelId]
  const defaultManual = JSON.parse(JSON.stringify(DEFAULT_MANUAL_SETTINGS)) as ManualSettings

  if (!channelConfig) {
    const linked = normalizeSignalChannelIds(broker.signal_channel_ids)
    if (linked.includes(channelId)) {
      return {
        copier_mode: fallbackMode,
        manual_settings: defaultManual,
        ai_settings: fallbackAi,
      }
    }
    return {
      copier_mode: fallbackMode,
      manual_settings: fallbackManual,
      ai_settings: fallbackAi,
    }
  }

  return {
    copier_mode: channelConfig.copier_mode ?? fallbackMode,
    manual_settings: (channelConfig.manual_settings ?? defaultManual) as ManualSettings,
    ai_settings: (channelConfig.ai_settings ?? fallbackAi) as Json,
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
