import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractTradableSymbolFromMessage,
  hasTradableInstrumentInText,
  isTradableInstrumentSymbol,
  minPlausibleQuotePrice,
  reconcileSymbolWithQuoteLevels,
  sanitizeParsedSymbol,
} from './tradableSymbol'

test('rejects common English 6-letter words', () => {
  for (const word of ['JOINED', 'WEEKLY', 'FORGET', 'CLOSED', 'SIGNAL', 'PUBLIC', 'TRADER', 'TARGET']) {
    assert.equal(isTradableInstrumentSymbol(word), false)
    assert.equal(extractTradableSymbolFromMessage(`Please ${word} the channel`), null)
  }
})

test('accepts forex, crypto, metal, and index symbols', () => {
  assert.equal(extractTradableSymbolFromMessage('BUY EURUSD now'), 'EURUSD')
  assert.equal(extractTradableSymbolFromMessage('GOLD buy 2650'), 'XAUUSD')
  assert.equal(extractTradableSymbolFromMessage('BTCUSDT long'), 'BTCUSDT')
  assert.equal(extractTradableSymbolFromMessage('sell US30 sl 42000'), 'US30')
  assert.equal(extractTradableSymbolFromMessage('EUR/USD buy'), 'EURUSD')
})

test('hasTradableInstrumentInText does not match random 6-letter words', () => {
  assert.equal(hasTradableInstrumentInText('we joined weekly forget'), false)
  assert.equal(hasTradableInstrumentInText('buy eurusd sl 1.08'), true)
})

test('sanitizeParsedSymbol strips invalid model output', () => {
  assert.equal(sanitizeParsedSymbol('JOINED'), null)
  assert.equal(sanitizeParsedSymbol('eurusd'), 'EURUSD')
})

test('extractTradableSymbolFromMessage prefers on/for phrase', () => {
  assert.equal(extractTradableSymbolFromMessage('Close half on EURUSD'), 'EURUSD')
  assert.equal(extractTradableSymbolFromMessage('breakeven for gold'), 'XAUUSD')
})

test('extracts Deriv synthetics and normalizes to canonical codes', () => {
  assert.equal(extractTradableSymbolFromMessage('BUY V75 now SL 100 TP 200'), 'R_75')
  assert.equal(extractTradableSymbolFromMessage('sell Vix75 entry'), 'R_75')
  assert.equal(extractTradableSymbolFromMessage('Volatility 75 Index buy'), 'R_75')
  assert.equal(extractTradableSymbolFromMessage('buy V75 (1s)'), '1HZ75V')
  assert.equal(extractTradableSymbolFromMessage('Boom 1000 buy now'), 'BOOM1000')
  assert.equal(extractTradableSymbolFromMessage('sell Step Index now'), 'STPRNG')
})

test('classifies and sanitizes Deriv canonical symbols', () => {
  assert.equal(isTradableInstrumentSymbol('R_75'), true)
  assert.equal(isTradableInstrumentSymbol('BOOM1000'), true)
  assert.equal(sanitizeParsedSymbol('R_75'), 'R_75')
  assert.equal(sanitizeParsedSymbol('V75'), 'R_75')
  assert.equal(sanitizeParsedSymbol('Boom 1000'), 'BOOM1000')
})

test('Deriv synthetics get a large minimum plausible quote price', () => {
  assert.equal(minPlausibleQuotePrice('R_75'), 100)
  assert.equal(minPlausibleQuotePrice('STPRNG'), 1000)
})

test('extracts US stock/ETF tickers from ForexBro Market line', () => {
  assert.equal(extractTradableSymbolFromMessage('Market: QQQ · BUY'), 'QQQ')
  assert.equal(extractTradableSymbolFromMessage('Market: SPY · BUY'), 'SPY')
  assert.equal(extractTradableSymbolFromMessage('Market: IWM · SELL'), 'IWM')
  assert.equal(isTradableInstrumentSymbol('QQQ'), true)
  assert.equal(minPlausibleQuotePrice('QQQ'), 1)
})

test('random 3-letter words are not tradable without Market line', () => {
  for (const word of ['NEW', 'THE', 'FOR']) {
    assert.equal(isTradableInstrumentSymbol(word), false)
    assert.equal(extractTradableSymbolFromMessage(`Please ${word} the channel`), null)
  }
})

test('extractTradableSymbolFromMessage prefers AUD-NZD hashtag over VIP footer Gold', () => {
  const msg = `📉AUD-NZD Free Signal!

⭕Sell!
—
#AUDNZD rejection from the horizontal supply area signals bearish continuation.
------------------
🟢Stop Loss: 1.2074
🟢Take Profit: 1.2034
🟢Entry: 1.2057
----------------—
Sell!🔽
➖➖➖➖➖➖➖➖➖➖
VIP MEMBERS GET
Forex, Gold, Oil signals`
  assert.equal(extractTradableSymbolFromMessage(msg), 'AUDNZD')
})

test('reconcileSymbolWithQuoteLevels fixes gold misread when prices are forex', () => {
  const msg = `#AUDNZD sell
Stop Loss: 1.2074
Take Profit: 1.2034
Entry: 1.2057
Forex, Gold, Oil signals`
  assert.equal(
    reconcileSymbolWithQuoteLevels('XAUUSD', msg, { sl: 1.2074, tp: [1.2034], entry: 1.2057 }),
    'AUDNZD',
  )
})
