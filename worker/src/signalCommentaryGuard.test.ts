import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeCasualNonTradeMessage, looksLikeProfitResultCommentary } from './signalCommentaryGuard'
import { entryMissingSlTpRequiresNow, messageHasExplicitSlTpLabels } from './signalEntryNowRequirement'

describe('looksLikeProfitResultCommentary', () => {
  const msg = `**INSANE RESULT** 🔥

**Darryl** from **the UK **🇬🇧 took my **GOLD BUY** from today and made** £1110** **PROFIT!** 💰

**Truly amazing to see ❤️**🔥`

  it('detects profit testimonial with gold buy mention', () => {
    assert.equal(looksLikeProfitResultCommentary(msg), true)
    assert.equal(looksLikeCasualNonTradeMessage(msg), true)
  })

  it('does not flag real signals with NOW and SL/TP', () => {
    const signal = 'GOLD BUY NOW 4532.7 SL: 4524.3 TP: 4535'
    assert.equal(looksLikeProfitResultCommentary(signal), false)
    assert.equal(looksLikeCasualNonTradeMessage(signal), false)
  })
})

describe('entryMissingSlTpRequiresNow', () => {
  it('requires NOW when only inferred TP exists without labels', () => {
    assert.equal(
      entryMissingSlTpRequiresNow(
        { action: 'buy', sl: null, tp: [1110] },
        'GOLD BUY from today made £1110 profit',
      ),
      true,
    )
  })

  it('does not require NOW when explicit SL/TP labels are present', () => {
    assert.equal(
      entryMissingSlTpRequiresNow(
        { action: 'sell', sl: 2665, tp: [2640] },
        'SELL GOLD 2655\nSL 2665\nTP 2640',
      ),
      false,
    )
  })

  it('does not require NOW when market intent is present', () => {
    assert.equal(
      entryMissingSlTpRequiresNow({ action: 'buy', sl: null, tp: [] }, 'Gold buy now'),
      false,
    )
  })
})

describe('messageHasExplicitSlTpLabels', () => {
  it('matches labeled SL and TP lines', () => {
    assert.equal(messageHasExplicitSlTpLabels('SL 2665\nTP 2640'), true)
    assert.equal(messageHasExplicitSlTpLabels('TP: 4510'), true)
    assert.equal(messageHasExplicitSlTpLabels('made £1110 profit'), false)
  })
})
