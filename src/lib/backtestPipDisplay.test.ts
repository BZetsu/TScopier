import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computePipsFromSignalOutcome, signalPipPrice } from './signalPip'
import { tradePipPnl } from './backtestDisplay'
import { buildBacktestResultsCsv } from './backtestCsv'
import type { BacktestTradeRow } from './backtestTypes'

describe('gold backtest pips use trader convention (1 pip = 0.1)', () => {
  it('signalPipPrice for XAUUSD is 0.1 not 0.01', () => {
    assert.equal(signalPipPrice('XAUUSD'), 0.1)
    assert.equal(signalPipPrice('GOLD'), 0.1)
  })

  it('all_tp_hit gold distance is in trader pips not points', () => {
    // Entry 4250 → TP 4260 = 10 price units = 100 trader pips (not 1000 points)
    const pips = computePipsFromSignalOutcome({
      symbol: 'XAUUSD',
      direction: 'buy',
      entry: 4250,
      sl: 4240,
      tpLevels: [4260],
      outcome: 'all_tp_hit',
      tpsHit: 1,
    })
    assert.equal(pips, 100)
  })

  it('tradePipPnl ignores stale stored cent-point pipPnl', () => {
    const trade = {
      symbol: 'XAUUSD',
      direction: 'buy',
      entry_price: 4250,
      exit_price: 4260,
      sl: 4240,
      tp_levels: [4260],
      outcome: 'all_tp_hit',
      tps_hit: 1,
      pnl: 0,
      lot_size: 0.01,
      details: { pipPnl: 1000 }, // old cent-point value
    }
    assert.equal(tradePipPnl(trade), 100)
  })
})

describe('buildBacktestResultsCsv', () => {
  it('includes header and recomputed gold pips', () => {
    const trades: BacktestTradeRow[] = [{
      id: 't1',
      symbol: 'XAUUSD',
      direction: 'buy',
      signal_at: '2026-08-01T12:00:00.000Z',
      outcome: 'all_tp_hit',
      tps_hit: 1,
      pnl: 10,
      pnl_r: null,
      entry_price: 4250,
      exit_price: 4260,
      closed_at: '2026-08-01T13:00:00.000Z',
      sl: 4240,
      tp_levels: [4260],
      lot_size: 0.01,
      channel_id: 'c1',
      details: { pipPnl: 1000 },
    }]
    const csv = buildBacktestResultsCsv(trades)
    assert.ok(csv.startsWith('\uFEFF'))
    assert.ok(csv.includes('Time,Symbol,Side,Entry,SL,TP Levels,Outcome,TPs Hit,Pips,Duration,Closed At'))
    assert.ok(csv.includes('XAUUSD'))
    assert.ok(csv.includes('100.00'))
    assert.ok(!csv.includes('1000.00'))
  })
})
