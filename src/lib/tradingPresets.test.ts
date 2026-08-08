import { describe, expect, it } from 'vitest'
import {
  TSCOPIER_PRESETS_FORMAT,
  buildTradingPresetsFile,
  parseTradingPresetsFile,
  serializeTradingPresetsFile,
  type ChannelTradingPreset,
} from './tradingPresets'
import { DEFAULT_CHANNEL_FILTERS } from './channelMessageFilters'
import { DEFAULT_MANUAL_SETTINGS } from './defaultManualSettings'

function samplePreset(name: string): ChannelTradingPreset {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    name,
    copier_mode: 'manual',
    manual_settings: { ...DEFAULT_MANUAL_SETTINGS, fixed_lot: 0.05 },
    channel_filters: { ...DEFAULT_CHANNEL_FILTERS },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('tradingPresets file format', () => {
  it('round-trips presets through serialize + parse', () => {
    const file = serializeTradingPresetsFile([samplePreset('Gold multi'), samplePreset('Scalp')])
    const parsed = parseTradingPresetsFile(file)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.name).toBe('Gold multi')
    expect(parsed[0]?.manual_settings.fixed_lot).toBe(0.05)
    expect(parsed[1]?.name).toBe('Scalp')
  })

  it('rejects unknown format', () => {
    expect(() =>
      parseTradingPresetsFile(JSON.stringify({
        format: 'other',
        version: 1,
        presets: [{ name: 'A', copier_mode: 'manual', manual_settings: {}, channel_filters: {} }],
      })),
    ).toThrow(/unrecognized format/i)
  })

  it('builds a versioned file envelope', () => {
    const built = buildTradingPresetsFile([samplePreset('A')])
    expect(built.format).toBe(TSCOPIER_PRESETS_FORMAT)
    expect(built.version).toBe(1)
    expect(built.presets[0]?.name).toBe('A')
  })
})
