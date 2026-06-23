import { describe, expect, it } from 'vitest'
import {
  isFxsocketMtStatusHealthy,
  listFxsocketMtStatusChecks,
  normalizeFxsocketMtStatus,
} from './fxsocketMtStatus'

const readySnapshot = {
  status: 'ready',
  terminal: { alive: true, build: 5836, pingMs: 39 },
  broker: { connected: true, server: 'FTMO-Server3' },
  account: {
    loggedIn: true,
    login: 531347665,
    currency: 'USD',
    type: 'Real',
    tradeAllowed: true,
  },
  bridge: { version: '0.5.0', tradeEaReady: true, symbolsSynced: true },
  serverTime: '2026-06-23T16:49:56.000Z',
}

describe('normalizeFxsocketMtStatus', () => {
  it('parses FxSocket /status health snapshot', () => {
    const status = normalizeFxsocketMtStatus(readySnapshot)
    expect(status.status).toBe('ready')
    expect(status.terminal?.alive).toBe(true)
    expect(status.broker?.connected).toBe(true)
    expect(status.account?.tradeAllowed).toBe(true)
    expect(status.bridge?.tradeEaReady).toBe(true)
    expect(isFxsocketMtStatusHealthy(status)).toBe(true)
  })

  it('is unhealthy when trade EA is not ready', () => {
    const status = normalizeFxsocketMtStatus({
      ...readySnapshot,
      bridge: { ...readySnapshot.bridge, tradeEaReady: false },
    })
    expect(isFxsocketMtStatusHealthy(status)).toBe(false)
    expect(listFxsocketMtStatusChecks(status).find(c => c.id === 'bridgeTradeEaReady')?.ok).toBe(false)
  })

  it('is unhealthy when status is not ready', () => {
    const status = normalizeFxsocketMtStatus({ ...readySnapshot, status: 'starting' })
    expect(isFxsocketMtStatusHealthy(status)).toBe(false)
  })
})
