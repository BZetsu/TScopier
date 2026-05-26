import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDefaultChannelTradingConfig,
  normalizeChannelTradingConfigsMap,
  resolveChannelTradingConfig,
  withChannelTradingConfig,
} from './channelTradingConfig'

test('resolveChannelTradingConfig falls back to broker-level settings', () => {
  const broker = {
    copier_mode: 'manual' as const,
    manual_settings: { fixed_lot: 0.05, trade_style: 'single' },
    ai_settings: { risk_percent_per_trade: 2 },
    channel_trading_configs: {},
  }
  const resolved = resolveChannelTradingConfig(broker, 'ch-1')
  assert.equal(resolved.copier_mode, 'manual')
  assert.equal(resolved.manual_settings.fixed_lot, 0.05)
  assert.equal(resolved.ai_settings.risk_percent_per_trade, 2)
})

test('resolveChannelTradingConfig uses per-channel override', () => {
  const broker = {
    copier_mode: 'manual' as const,
    manual_settings: { fixed_lot: 0.05, trade_style: 'single' },
    ai_settings: {},
    channel_trading_configs: {
      'ch-a': { copier_mode: 'manual' as const, manual_settings: { fixed_lot: 0.02, trade_style: 'multi' } },
      'ch-b': { copier_mode: 'manual' as const, manual_settings: { fixed_lot: 0.08, trade_style: 'single' } },
    },
  }
  const a = resolveChannelTradingConfig(broker, 'ch-a')
  const b = resolveChannelTradingConfig(broker, 'ch-b')
  assert.equal(a.manual_settings.trade_style, 'multi')
  assert.equal(a.manual_settings.fixed_lot, 0.02)
  assert.equal(b.manual_settings.fixed_lot, 0.08)
})

test('withChannelTradingConfig overlays broker row', () => {
  const broker = {
    id: 'b1',
    copier_mode: 'manual' as const,
    manual_settings: { fixed_lot: 0.05 },
    channel_trading_configs: {
      ch1: { manual_settings: { fixed_lot: 0.11 } },
    },
  }
  const effective = withChannelTradingConfig(broker, 'ch1')
  assert.equal(effective.manual_settings.fixed_lot, 0.11)
  assert.equal(effective.id, 'b1')
})

test('buildDefaultChannelTradingConfig seeds manual defaults', () => {
  const cfg = buildDefaultChannelTradingConfig()
  assert.equal(cfg.copier_mode, 'manual')
  assert.equal(cfg.manual_settings?.trade_style, 'single')
})

test('normalizeChannelTradingConfigsMap skips invalid entries', () => {
  const map = normalizeChannelTradingConfigsMap({
    ok: { copier_mode: 'manual', manual_settings: { fixed_lot: 0.01 } },
    '': { copier_mode: 'manual' },
    bad: 'nope',
  })
  assert.ok(map.ok)
  assert.equal(Object.keys(map).length, 1)
})
