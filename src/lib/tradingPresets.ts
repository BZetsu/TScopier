import { supabase } from './supabase'
import type { ManualSettings } from '../types/database'
import {
  DEFAULT_CHANNEL_FILTERS,
  normalizeChannelFilters,
  type ChannelFilters,
} from './channelMessageFilters'

export interface ChannelTradingPreset {
  id: string
  user_id: string
  name: string
  copier_mode: 'ai' | 'manual'
  manual_settings: ManualSettings
  channel_filters: ChannelFilters
  created_at: string
  updated_at: string
}

export interface ChannelConfigPresetPayload {
  mode: 'ai' | 'manual'
  manualSettings: ManualSettings
  channelFilters: ChannelFilters
}

const PRESET_SELECT = 'id,user_id,name,copier_mode,manual_settings,channel_filters,created_at,updated_at'

function normalizePresetRow(row: Record<string, unknown>): ChannelTradingPreset {
  const mode = row.copier_mode
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name ?? ''),
    copier_mode: mode === 'ai' ? 'ai' : 'manual',
    manual_settings: (row.manual_settings && typeof row.manual_settings === 'object'
      ? row.manual_settings
      : {}) as ManualSettings,
    channel_filters: normalizeChannelFilters(row.channel_filters ?? DEFAULT_CHANNEL_FILTERS),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function listTradingPresets(userId: string): Promise<ChannelTradingPreset[]> {
  const { data, error } = await supabase
    .from('channel_trading_presets')
    .select(PRESET_SELECT)
    .eq('user_id', userId)
    .order('name')
  if (error) throw error
  return (data ?? []).map(row => normalizePresetRow(row as Record<string, unknown>))
}

export async function upsertTradingPreset(
  userId: string,
  name: string,
  payload: ChannelConfigPresetPayload,
): Promise<ChannelTradingPreset> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Preset name is required')

  const row = {
    user_id: userId,
    name: trimmed,
    copier_mode: payload.mode,
    manual_settings: {
      ...payload.manualSettings,
      allow_high_impact_news: payload.manualSettings.news_trading_enabled === true,
    },
    channel_filters: payload.channelFilters,
  }

  const { data, error } = await supabase
    .from('channel_trading_presets')
    .upsert(row, { onConflict: 'user_id,name' })
    .select(PRESET_SELECT)
    .single()

  if (error) throw error
  return normalizePresetRow(data as Record<string, unknown>)
}

export function presetToChannelConfigDraft(preset: ChannelTradingPreset): ChannelConfigPresetPayload {
  return {
    mode: preset.copier_mode,
    manualSettings: JSON.parse(JSON.stringify(preset.manual_settings)) as ManualSettings,
    channelFilters: JSON.parse(JSON.stringify(preset.channel_filters)) as ChannelFilters,
  }
}
