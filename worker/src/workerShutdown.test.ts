import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { telegramShutdownDrainMs } from './workerShutdown'

describe('telegramShutdownDrainMs', () => {
  it('defaults to about 30 seconds', () => {
    const prev = process.env.TELEGRAM_SHUTDOWN_DRAIN_MS
    delete process.env.TELEGRAM_SHUTDOWN_DRAIN_MS
    try {
      assert.equal(telegramShutdownDrainMs(), 30_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_SHUTDOWN_DRAIN_MS
      else process.env.TELEGRAM_SHUTDOWN_DRAIN_MS = prev
    }
  })

  it('honors configured values above the old 10 second cap', () => {
    const prev = process.env.TELEGRAM_SHUTDOWN_DRAIN_MS
    process.env.TELEGRAM_SHUTDOWN_DRAIN_MS = '30000'
    try {
      assert.equal(telegramShutdownDrainMs(), 30_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_SHUTDOWN_DRAIN_MS
      else process.env.TELEGRAM_SHUTDOWN_DRAIN_MS = prev
    }
  })
})
