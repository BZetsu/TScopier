import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { channelMatchesBrokerSignal } from './brokerChannelFilter'

describe('channelMatchesBrokerSignal', () => {
  const chA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const chB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  it('allows any channel when no whitelist is configured', () => {
    assert.equal(channelMatchesBrokerSignal({}, chA), true)
    assert.equal(channelMatchesBrokerSignal({ enforce_signal_channel_filter: false }, chA), true)
  })

  it('restricts to listed channels when enforce is true', () => {
    const broker = { enforce_signal_channel_filter: true, signal_channel_ids: [chA] }
    assert.equal(channelMatchesBrokerSignal(broker, chA), true)
    assert.equal(channelMatchesBrokerSignal(broker, chB), false)
  })

  it('honors persisted ids even when enforce flag is false (legacy saves)', () => {
    const broker = { enforce_signal_channel_filter: false, signal_channel_ids: [chA, chB] }
    assert.equal(channelMatchesBrokerSignal(broker, chA), true)
    assert.equal(channelMatchesBrokerSignal(broker, 'other'), false)
  })

  it('denies when whitelist mode is on but list is empty', () => {
    assert.equal(channelMatchesBrokerSignal({ enforce_signal_channel_filter: true }, chA), false)
  })
})
