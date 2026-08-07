import { describe, expect, it } from 'vitest'
import {
  brokerCanReconnect,
  brokerEffectiveConnectionStatus,
  brokerConnectionBadgeVariant,
} from './brokerReconnect'

describe('brokerEffectiveConnectionStatus', () => {
  it('prefers connection_status error over fxsocket connected', () => {
    expect(brokerEffectiveConnectionStatus({
      fxsocket_status: 'connected',
      connection_status: 'error',
    })).toBe('error')
  })

  it('falls back to fxsocket_status when connection is connected', () => {
    expect(brokerEffectiveConnectionStatus({
      fxsocket_status: 'error',
      connection_status: 'connected',
    })).toBe('error')
  })
})

describe('brokerCanReconnect', () => {
  const uuid = '11111111-2222-3333-4444-555555555555'

  it('shows reconnect when worker marked error but fxsocket still connected', () => {
    expect(brokerCanReconnect({
      fxsocket_account_id: uuid,
      fxsocket_status: 'connected',
      connection_status: 'error',
    })).toBe(true)
  })

  it('shows reconnect for disconnected fxsocket status', () => {
    expect(brokerCanReconnect({
      fxsocket_account_id: uuid,
      fxsocket_status: 'disconnected',
      connection_status: 'connected',
    })).toBe(true)
  })

  it('hides reconnect when fully connected', () => {
    expect(brokerCanReconnect({
      fxsocket_account_id: uuid,
      fxsocket_status: 'connected',
      connection_status: 'connected',
    })).toBe(false)
  })

  it('hides reconnect without fxsocket session', () => {
    expect(brokerCanReconnect({
      fxsocket_account_id: '',
      fxsocket_status: 'error',
      connection_status: 'error',
    })).toBe(false)
  })
})

describe('brokerConnectionBadgeVariant', () => {
  it('marks worker-only downs as error', () => {
    expect(brokerConnectionBadgeVariant({
      is_active: true,
      fxsocket_status: 'connected',
      connection_status: 'error',
    })).toBe('error')
  })
})
