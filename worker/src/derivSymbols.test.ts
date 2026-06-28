import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  derivSyntheticFamily,
  isDerivSyntheticSymbol,
  normalizeDerivAlias,
  resolveDerivCanonicalToBrokerSymbol,
} from './derivSymbols'

test('normalizeDerivAlias maps volatility aliases to the 2s symbol by default', () => {
  for (const alias of ['V75', 'Vix75', 'VIX 75', 'VOL 75', 'Volatility 75', 'Volatility 75 Index', 'R_75', 'R75']) {
    assert.equal(normalizeDerivAlias(alias), 'R_75', `alias=${alias}`)
  }
})

test('normalizeDerivAlias maps explicit 1s markers to the 1HZ symbol', () => {
  assert.equal(normalizeDerivAlias('V75(1s)'), '1HZ75V')
  assert.equal(normalizeDerivAlias('V75 1S'), '1HZ75V')
  assert.equal(normalizeDerivAlias('Volatility 75 (1s) Index'), '1HZ75V')
  assert.equal(normalizeDerivAlias('1HZ75V'), '1HZ75V')
})

test('normalizeDerivAlias covers boom, crash, step, jump, range and bull/bear', () => {
  assert.equal(normalizeDerivAlias('Boom 1000'), 'BOOM1000')
  assert.equal(normalizeDerivAlias('BOOM1000'), 'BOOM1000')
  assert.equal(normalizeDerivAlias('Crash 500'), 'CRASH500')
  assert.equal(normalizeDerivAlias('Step Index'), 'STPRNG')
  assert.equal(normalizeDerivAlias('Step 200 Index'), 'STPRNG2')
  assert.equal(normalizeDerivAlias('Jump 75'), 'JD75')
  assert.equal(normalizeDerivAlias('JD100'), 'JD100')
  assert.equal(normalizeDerivAlias('Range Break 100'), 'RB_100')
  assert.equal(normalizeDerivAlias('RDBULL'), 'RDBULL')
  assert.equal(normalizeDerivAlias('Bear Market Index'), 'RDBEAR')
})

test('normalizeDerivAlias rejects non-synthetic and out-of-range tokens', () => {
  for (const word of ['JOINED', 'SIGNAL', 'TARGET', 'EURUSD', 'V7', 'V999', 'BOOM7']) {
    assert.equal(normalizeDerivAlias(word), null, `word=${word}`)
  }
})

test('isDerivSyntheticSymbol recognizes canonical codes only', () => {
  for (const s of ['R_75', '1HZ75V', 'BOOM1000', 'CRASH500', 'STPRNG', 'STPRNG2', 'JD75', 'RB_100', 'RDBULL']) {
    assert.equal(isDerivSyntheticSymbol(s), true, `s=${s}`)
  }
  for (const s of ['V75', 'EURUSD', 'XAUUSD', 'Volatility 75 Index', '']) {
    assert.equal(isDerivSyntheticSymbol(s), false, `s=${s}`)
  }
})

test('derivSyntheticFamily classifies each family', () => {
  assert.equal(derivSyntheticFamily('R_75'), 'volatility')
  assert.equal(derivSyntheticFamily('1HZ75V'), 'volatility')
  assert.equal(derivSyntheticFamily('BOOM1000'), 'boom')
  assert.equal(derivSyntheticFamily('CRASH500'), 'crash')
  assert.equal(derivSyntheticFamily('STPRNG2'), 'step')
  assert.equal(derivSyntheticFamily('JD75'), 'jump')
  assert.equal(derivSyntheticFamily('RB_100'), 'range_break')
  assert.equal(derivSyntheticFamily('RDBEAR'), 'bull_bear')
  assert.equal(derivSyntheticFamily('EURUSD'), null)
})

test('resolveDerivCanonicalToBrokerSymbol matches DMT5 display names', () => {
  const inventory = [
    'Volatility 75 Index',
    'Volatility 75 (1s) Index',
    'Boom 1000 Index',
    'Crash 500 Index',
    'Step Index',
    'EURUSD',
  ]
  assert.equal(resolveDerivCanonicalToBrokerSymbol('R_75', inventory), 'Volatility 75 Index')
  assert.equal(resolveDerivCanonicalToBrokerSymbol('1HZ75V', inventory), 'Volatility 75 (1s) Index')
  assert.equal(resolveDerivCanonicalToBrokerSymbol('BOOM1000', inventory), 'Boom 1000 Index')
  assert.equal(resolveDerivCanonicalToBrokerSymbol('CRASH500', inventory), 'Crash 500 Index')
  assert.equal(resolveDerivCanonicalToBrokerSymbol('STPRNG', inventory), 'Step Index')
})

test('resolveDerivCanonicalToBrokerSymbol matches exact short codes', () => {
  const inventory = ['R_75', 'R_100', 'BOOM1000', 'EURUSD']
  assert.equal(resolveDerivCanonicalToBrokerSymbol('R_75', inventory), 'R_75')
  assert.equal(resolveDerivCanonicalToBrokerSymbol('BOOM1000', inventory), 'BOOM1000')
})

test('resolveDerivCanonicalToBrokerSymbol returns null when broker lacks the symbol', () => {
  assert.equal(resolveDerivCanonicalToBrokerSymbol('R_250', ['Volatility 75 Index', 'EURUSD']), null)
  assert.equal(resolveDerivCanonicalToBrokerSymbol('EURUSD', ['Volatility 75 Index']), null)
})
