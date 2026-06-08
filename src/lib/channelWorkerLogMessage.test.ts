import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { channelWorkerEn } from '../i18n/channelWorker/en'
import { channelWorkerLogMessage } from './channelWorkerLogMessage'

test('channelWorkerLogMessage: shows skipped breakeven management', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'dispatch_skipped',
      status: 'skipped',
      request_payload: { skip_reason: 'channel_filter_ignored' },
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'breakeven', symbol: 'XAUUSD' },
        status: 'skipped',
        skip_reason: 'channel_filter_ignored',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'James VIP Signals' },
  )
  assert.ok(message)
  assert.match(message!, /Did not copy|Ignore/i)
})

test('channelWorkerLogMessage: shows skipped modify via mgmt log', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'mgmt_modify',
      status: 'skipped',
      request_payload: { skip_reason: 'mgmt_no_open_trades' },
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'modify', symbol: 'XAUUSD' },
        status: 'skipped',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'Fredtrading' },
  )
  assert.ok(message)
  assert.match(message!, /modify|stop|open trade/i)
})

test('channelWorkerLogMessage: virtual_pending_fired success remaps when signal skipped', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'virtual_pending_fired',
      status: 'success',
      request_payload: { symbol: 'XAUUSD' },
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'buy', symbol: 'XAUUSD' },
        status: 'skipped',
        skip_reason: 'channel_config_incomplete',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'James VIP Signals' },
  )
  assert.ok(message)
  assert.doesNotMatch(message!, /Layered entry order triggered/i)
  assert.match(message!, /Did not place an order/i)
  assert.match(message!, /incomplete/i)
})

test('channelWorkerLogMessage: mgmt success remaps when signal skipped', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'mgmt_modify',
      status: 'success',
      request_payload: { symbol: 'XAUUSD' },
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'modify', symbol: 'XAUUSD' },
        status: 'skipped',
        skip_reason: 'no_matching_open_trade',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'James VIP Signals' },
  )
  assert.ok(message)
  assert.doesNotMatch(message!, /Applied the update/i)
  assert.match(message!, /Skipped the XAUUSD update/i)
  assert.match(message!, /no matching open trade/i)
})

test('channelWorkerLogMessage: completed sell fallback remaps when signal skipped', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'handle_end',
      status: 'success',
      request_payload: null,
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'sell', symbol: 'EURUSD' },
        status: 'skipped',
        skip_reason: 'broker_session_not_connected',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'James VIP Signals' },
  )
  assert.equal(message, null)
})

test('channelWorkerLogMessage: unknown success action remaps sell when signal skipped', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'some_internal_step',
      status: 'success',
      request_payload: null,
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'sell', symbol: 'EURUSD' },
        status: 'skipped',
        skip_reason: 'broker_session_not_connected',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'James VIP Signals' },
  )
  assert.ok(message)
  assert.doesNotMatch(message!, /^Completed: sell/i)
  assert.match(message!, /Did not copy this signal/i)
  assert.match(message!, /broker not connected/i)
})

test('channelWorkerLogMessage: pipeline_summary does not show false Completed sell', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'pipeline_summary',
      status: 'success',
      request_payload: { pipeline_ms: 1200 },
      response_payload: null,
      error_message: null,
      signals: {
        channel_id: 'ch-1',
        parsed_data: { action: 'sell', symbol: 'XAUUSD' },
        status: 'parsed',
      },
    },
    channelWorkerEn,
    { 'ch-1': 'SIGNALS PRO' },
  )
  assert.equal(message, null)
})

test('channelWorkerLogMessage: still hides non-trade commentary', () => {
  const message = channelWorkerLogMessage(
    {
      action: 'pipeline_parse_dispatch',
      status: 'success',
      request_payload: null,
      response_payload: null,
      error_message: null,
      signals: {
        parsed_data: { action: 'ignore' },
        skip_reason: 'non_trade_message',
      },
    },
    channelWorkerEn,
  )
  assert.equal(message, null)
})
