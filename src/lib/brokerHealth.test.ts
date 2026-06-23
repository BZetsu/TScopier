import { describe, expect, it } from 'vitest'
import {
  brokerTerminalHealthLabel,
  brokerTerminalHealthPhase,
} from './brokerHealth'
import type { BrokerAccount } from '../types/database'

const labels = {
  statusHealthy: 'Healthy',
  statusUnhealthy: 'Unhealthy',
  statusHealthChecking: 'Checking…',
}

function broker(
  patch: Partial<BrokerAccount>,
): Pick<
  BrokerAccount,
  'is_active' | 'connection_status' | 'fxsocket_status' | 'terminal_connected' | 'trade_allowed'
> {
  return {
    is_active: true,
    connection_status: 'connected',
    fxsocket_status: 'connected',
    terminal_connected: null,
    trade_allowed: null,
    ...patch,
  }
}

describe('brokerTerminalHealthPhase', () => {
  it('returns paused when copy trades is off', () => {
    expect(brokerTerminalHealthPhase(broker({ is_active: false }))).toBe('paused')
  })

  it('returns checking while linking', () => {
    expect(brokerTerminalHealthPhase(broker({ connection_status: 'pending' }))).toBe('checking')
    expect(brokerTerminalHealthPhase(broker({ fxsocket_status: 'connecting' }))).toBe('checking')
  })

  it('returns healthy when terminal is connected and trading allowed', () => {
    expect(
      brokerTerminalHealthPhase(broker({ terminal_connected: true, trade_allowed: true })),
    ).toBe('healthy')
  })

  it('returns unhealthy when trade is not allowed', () => {
    expect(
      brokerTerminalHealthPhase(broker({ terminal_connected: true, trade_allowed: false })),
    ).toBe('unhealthy')
  })

  it('returns unhealthy when terminal is disconnected', () => {
    expect(
      brokerTerminalHealthPhase(broker({ terminal_connected: false, trade_allowed: true })),
    ).toBe('unhealthy')
  })
})

describe('brokerTerminalHealthLabel', () => {
  it('returns null for paused brokers', () => {
    expect(brokerTerminalHealthLabel(broker({ is_active: false }), labels)).toBeNull()
  })

  it('maps phases to labels', () => {
    expect(
      brokerTerminalHealthLabel(broker({ terminal_connected: true, trade_allowed: true }), labels),
    ).toBe('Healthy')
    expect(
      brokerTerminalHealthLabel(broker({ terminal_connected: false }), labels),
    ).toBe('Unhealthy')
    expect(brokerTerminalHealthLabel(broker({}), labels)).toBe('Checking…')
  })
})
