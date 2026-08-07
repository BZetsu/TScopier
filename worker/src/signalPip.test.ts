import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  getPipMultiplierForSymbol,
  signalPipPrice,
} from './signalPip'

test('signalPipPrice: FX and metals match backtest multipliers', () => {
  assert.equal(signalPipPrice('EURUSD'), 0.0001)
  assert.equal(getPipMultiplierForSymbol('EURUSD'), 10_000)
  assert.equal(signalPipPrice('USDJPY'), 0.01)
  assert.equal(signalPipPrice('XAUUSD'), 0.1)
  assert.equal(getPipMultiplierForSymbol('XAUUSD'), 10)
  assert.equal(signalPipPrice('XAGUSD'), 0.10)
})

test('signalPipPrice: XAUUSD 5 pips is 0.5 price units', () => {
  const pip = signalPipPrice('XAUUSD')
  assert.equal(pip, 0.1)
  assert.equal(5 * pip, 0.5)
  assert.equal(4330 + 5 * pip, 4330.5)
  assert.equal(4300 - 5 * pip, 4299.5)
})

test('signalPipPrice: short index symbols use index multiplier', () => {
  assert.equal(signalPipPrice('US30'), 1)
  assert.equal(getPipMultiplierForSymbol('US30'), 1)
})
