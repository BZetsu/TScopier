import { describe, expect, it } from 'vitest'
import {
  BROKER_BRIDGE_UNAVAILABLE_SKIP_KEY,
  formatBrokerBridgeErrorMessage,
  isBrokerBridgeUnavailableMessage,
  normalizeCopierSkipReasonKey,
} from './brokerBridgeErrorDisplay'

const labels = {
  bridgeUnavailable: 'Bridge unavailable',
  tradeEaNotReady: 'EA not ready',
}

describe('normalizeCopierSkipReasonKey', () => {
  it('maps HTTP 503 to broker_bridge_unavailable', () => {
    expect(normalizeCopierSkipReasonKey('HTTP 503')).toBe(BROKER_BRIDGE_UNAVAILABLE_SKIP_KEY)
    expect(normalizeCopierSkipReasonKey('http 503')).toBe(BROKER_BRIDGE_UNAVAILABLE_SKIP_KEY)
  })
})

describe('isBrokerBridgeUnavailableMessage', () => {
  it('detects HTTP 503', () => {
    expect(isBrokerBridgeUnavailableMessage('HTTP 503')).toBe(true)
  })
})

describe('formatBrokerBridgeErrorMessage', () => {
  it('returns bridge copy for HTTP 503', () => {
    expect(formatBrokerBridgeErrorMessage('HTTP 503', labels)).toBe(labels.bridgeUnavailable)
  })
})
