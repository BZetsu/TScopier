import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  formatCopierSkipReasonDetail,
  formatCopierSkipReasonShort,
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
