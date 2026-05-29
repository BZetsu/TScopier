import { normalizeManualSettingsForExecution } from './manualPlanning/normalizeManualSettings'
import type { ManualSettings } from './manualPlanning/types'
import { normalizeSignalChannelIds } from './brokerChannelFilter'

export interface ChannelTradingConfig {
  copier_mode?: 'ai' | 'manual'
  manual_settings?: ManualSettings | Record<string, unknown> | null
  ai_settings?: Record<string, unknown> | null
}

export type ChannelTradingConfigsMap = Record<string, ChannelTradingConfig>

export type BrokerChannelTradingFields = {
  copier_mode?: 'ai' | 'manual' | string | null
  manual_settings?: Record<string, unknown> | null
  ai_settings?: Record<string, unknown> | null
  channel_trading_configs?: unknown
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
        ? (row.manual_settings as Record<string, unknown>)
        : undefined,
      ai_settings: row.ai_settings && typeof row.ai_settings === 'object'
        ? (row.ai_settings as Record<string, unknown>)
        : undefined,
    }
  }
  return out
}

export function buildDefaultChannelTradingConfig(): ChannelTradingConfig {
  return {
    copier_mode: 'manual',
    manual_settings: normalizeManualSettingsForExecution({}) as Record<string, unknown>,
    ai_settings: {},
  }
}

export function resolveChannelTradingConfig(
  broker: BrokerChannelTradingFields,
  channelId: string | null | undefined,
): {
  copier_mode: 'ai' | 'manual'
  manual_settings: Record<string, unknown>
  ai_settings: Record<string, unknown>
} {
  const fallbackMode = (broker.copier_mode ?? 'manual') as 'ai' | 'manual'
  const fallbackManual = normalizeManualSettingsForExecution(broker.manual_settings) as Record<string, unknown>
  const fallbackAi = (broker.ai_settings ?? {}) as Record<string, unknown>

  if (!channelId) {
    return {
      copier_mode: fallbackMode,
      manual_settings: fallbackManual,
      ai_settings: fallbackAi,
    }
  }

  const configs = normalizeChannelTradingConfigsMap(broker.channel_trading_configs)
  const channelConfig = configs[channelId]
  const defaultManual = normalizeManualSettingsForExecution(
    buildDefaultChannelTradingConfig().manual_settings,
  ) as Record<string, unknown>

  if (!channelConfig) {
    const linked = normalizeSignalChannelIds(broker.signal_channel_ids)
    if (linked.includes(channelId)) {
      console.warn(
        `[channelTradingConfig] linked channel ${channelId} has no saved config — using single-trade defaults (not broker-level manual_settings)`,
      )
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
    manual_settings: normalizeManualSettingsForExecution(
      channelConfig.manual_settings ?? defaultManual,
    ) as Record<string, unknown>,
    ai_settings: (channelConfig.ai_settings ?? fallbackAi) as Record<string, unknown>,
  }
}

export function withChannelTradingConfig<T extends BrokerChannelTradingFields>(
  broker: T,
  channelId: string | null | undefined,
): T {
  const resolved = resolveChannelTradingConfig(broker, channelId)
  return {
    ...broker,
    copier_mode: resolved.copier_mode,
    manual_settings: resolved.manual_settings,
    ai_settings: resolved.ai_settings,
  }
}

export function cloneChannelTradingConfig(from: ChannelTradingConfig): ChannelTradingConfig {
  return {
    copier_mode: from.copier_mode ?? 'manual',
    manual_settings: from.manual_settings
      ? JSON.parse(JSON.stringify(from.manual_settings))
      : buildDefaultChannelTradingConfig().manual_settings,
    ai_settings: from.ai_settings
      ? JSON.parse(JSON.stringify(from.ai_settings))
      : {},
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
