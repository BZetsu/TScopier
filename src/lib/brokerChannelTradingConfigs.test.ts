import { describe, expect, it } from 'vitest'
import {
  channelTradingConfigsMapFromRows,
  mergeBrokerWithChannelTradingConfigRows,
} from './brokerChannelTradingConfigs'
import type { BrokerAccount } from '../types/database'

const broker = {
  id: 'broker-1',
  user_id: 'user-1',
  channel_trading_configs: {
    'channel-a': {
      copier_mode: 'manual',
      manual_settings: { fixed_lot: 0.01, trade_style: 'single' },
      ai_settings: {},
    },
  },
} as unknown as BrokerAccount

describe('brokerChannelTradingConfigs', () => {
  it('table rows override stale JSONB lot size', () => {
    const merged = mergeBrokerWithChannelTradingConfigRows(broker, [
      {
        id: 'row-1',
        broker_account_id: 'broker-1',
        channel_id: 'channel-a',
        copier_mode: 'manual',
        manual_settings: { fixed_lot: 9, trade_style: 'single', schema_version: 1 },
        ai_settings: {},
        updated_at: '2026-06-08T00:00:00Z',
      },
    ])
    const configs = merged.channel_trading_configs as Record<string, { manual_settings?: { fixed_lot?: number } }>
    expect(configs['channel-a']?.manual_settings?.fixed_lot).toBe(9)
  })

  it('stamps schema_version when building map from rows', () => {
    const map = channelTradingConfigsMapFromRows([
      {
        id: 'row-1',
        broker_account_id: 'broker-1',
        channel_id: 'channel-b',
        copier_mode: 'manual',
        manual_settings: { fixed_lot: 2, trade_style: 'single' },
        ai_settings: {},
        updated_at: '2026-06-08T00:00:00Z',
      },
    ])
    expect(map['channel-b']?.manual_settings?.schema_version).toBe(1)
  })
})
