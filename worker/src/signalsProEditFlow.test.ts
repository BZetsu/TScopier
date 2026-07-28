import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseChannelMessageSync, DEFAULT_CHANNEL_KEYWORDS } from './parseSignal'
import {
  shouldOverlayChannelParamsOnBasketRefresh,
  shouldPreferParsedStopsOnEntry,
  mergeParsedWithChannelParams,
} from './channelActiveTradeParams'
import { shouldRouteAsBasketParameterRefresh } from './multiTradeMerge'
import { entryDispatchLooksSettleable, revisionCompletesSettleableEntry, revisionHasDeterministicActionableParse } from './signalRevision'
import { messageRevisionBypassesMergeLinking } from './signalMergeLink'
import { signalLooksLikeTeaserBasket } from './signalTelegramReconcile'

const SIGNALS_PRO_TEASER = 'Gold buy now'

const SIGNALS_PRO_FULL = `Gold buy now

SL: 4190

TP: 4210
TP: 4220
TP: 4225
TP: 4240
TP: open`

describe('SIGNALS PRO edit flow', () => {
  it('teaser parse is settleable bare entry', () => {
    const teaser = parseChannelMessageSync(SIGNALS_PRO_TEASER, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(teaser.status, 'parsed')
    assert.equal(teaser.parsed.action, 'buy')
    assert.equal(entryDispatchLooksSettleable(teaser.parsed), true)
    assert.equal(signalLooksLikeTeaserBasket(teaser.parsed as unknown as Record<string, unknown>), true)
  })

  it('full message parses SL/TP without AI', () => {
    const full = parseChannelMessageSync(SIGNALS_PRO_FULL, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(full.status, 'parsed')
    assert.equal(full.parsed.sl, 4190)
    assert.deepEqual(full.parsed.tp, [4210, 4220, 4225, 4240])
    assert.equal(shouldPreferParsedStopsOnEntry(full.parsed), true)
    const teaser = parseChannelMessageSync(SIGNALS_PRO_TEASER, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(revisionCompletesSettleableEntry(teaser.parsed, full.parsed), true)
  })

  it('edited SL/TP ladder on complete entry is deterministic without AI', () => {
    const prior = parseChannelMessageSync(
      'Gold sell now\nTP: 4046/4043/4042\nSL: 4055',
      DEFAULT_CHANNEL_KEYWORDS,
      null,
    )
    const edited = parseChannelMessageSync(
      'Gold sell now\nTP: 4046/4043/4040\nSL: 4052',
      DEFAULT_CHANNEL_KEYWORDS,
      null,
    )
    assert.equal(prior.status, 'parsed')
    assert.equal(edited.status, 'parsed')
    assert.equal(edited.parsed.sl, 4052)
    assert.deepEqual(edited.parsed.tp, [4046, 4043, 4040])
    assert.equal(revisionCompletesSettleableEntry(prior.parsed, edited.parsed), false)
    assert.equal(
      revisionHasDeterministicActionableParse(prior.parsed, edited.parsed),
      true,
    )
  })

  it('full buy-now message does not route as parameter refresh but has explicit stops', () => {
    const full = parseChannelMessageSync(SIGNALS_PRO_FULL, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(shouldRouteAsBasketParameterRefresh(full.parsed), false)
    assert.equal(shouldPreferParsedStopsOnEntry(full.parsed), true)
  })

  it('message revision bypasses merge linking for cross-anchor SL/TP refresh', () => {
    const full = parseChannelMessageSync(SIGNALS_PRO_FULL, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(
      messageRevisionBypassesMergeLinking({
        sameSignalRefresh: true,
        hasExplicitStops: shouldPreferParsedStopsOnEntry(full.parsed),
      }),
      true,
    )
    assert.equal(
      messageRevisionBypassesMergeLinking({
        sameSignalRefresh: false,
        hasExplicitStops: true,
      }),
      false,
    )
  })

  it('channel overlay blocked when message carries SL/TP on merge', () => {
    const full = parseChannelMessageSync(SIGNALS_PRO_FULL, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(
      shouldOverlayChannelParamsOnBasketRefresh(full.parsed, 'signal_merge_into_open_trade'),
      false,
    )
    const gapFill = mergeParsedWithChannelParams(full.parsed, {
      symbol: 'XAUUSD',
      stoploss: 4214,
      tpLevels: [4230, 4235, 4237],
    })
    assert.equal(gapFill.sl, 4190)
    assert.deepEqual(gapFill.tp, [4210, 4220, 4225, 4240])
  })
})
