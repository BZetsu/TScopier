import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  formatCopierSkipReasonDetail,
  formatCopierSkipReasonShort,
  getTradeFailureDisplayFromLog,
} from './copierLogDetail'
import { resolveCopierSkipReasonKey } from './copierSkipReasonLabels'
import { en } from '../i18n/locales/en'

test('resolveCopierSkipReasonKey maps broker Invalid stops message', () => {
  assert.equal(resolveCopierSkipReasonKey('Invalid stops'), 'invalid_stops')
  assert.equal(resolveCopierSkipReasonKey('channel_max_risk_hit'), 'channel_max_risk_hit')
})

test('formatCopierSkipReasonShort uses friendly label', () => {
  const label = formatCopierSkipReasonShort('channel_max_risk_hit', en.copierLogs)
  assert.equal(label, 'Daily risk limit reached')
})

test('formatCopierSkipReasonDetail returns actionable text', () => {
  const detail = formatCopierSkipReasonDetail('invalid_stops', en.copierLogs)
  assert.match(detail ?? '', /broker rejected/i)
})

test('getTradeFailureDisplayFromLog reads structured reason payload', () => {
  const display = getTradeFailureDisplayFromLog({
    error_message: 'HTTP 500',
    request_payload: {
      reason_code: 'BROKER_SYMBOL_NOT_FOUND',
      symbol: 'XAUUSD',
    },
  })
  assert.equal(display?.reasonCode, 'BROKER_SYMBOL_NOT_FOUND')
  assert.match(display?.explanation ?? '', /GOLD\/XAUUSD/)
})

test('getTradeFailureDisplayFromLog keeps legacy broker messages readable', () => {
  const display = getTradeFailureDisplayFromLog({
    error_message: 'Symbol not found: XAUUSD',
    request_payload: null,
  })
  assert.equal(display?.reasonCode, 'BROKER_SYMBOL_NOT_FOUND')
})
