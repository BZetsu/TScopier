import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CHANNEL_KEYWORDS, parseChannelMessageSync } from './parseSignal'

describe('Forex Place ELITE GOLD TRADE IDEA', () => {
  it('parses SELL XAUUSD zone with TP tiers and disclaimer footer', () => {
    const msg = `TRADE IDEA

SELL XAUUSD 4115–4125

🤑 TP1: 4112
🤑 TP2: 4107
🤑 TP3: 4092
🤑 TP4: 3047

🔴 SL: 4130

For educational and informational purposes only – no investment advice and no solicitation to buy or sell. Leveraged products carry a high risk of loss up to a total loss. Any action is taken at your own responsibility.`
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(result.status, 'parsed', `skip=${result.skip_reason}`)
    assert.equal(result.parsed.action, 'sell')
    assert.equal(result.parsed.symbol, 'XAUUSD')
    assert.equal(result.parsed.entry_zone_low, 4115)
    assert.equal(result.parsed.entry_zone_high, 4125)
    assert.equal(result.parsed.sl, 4130)
    assert.deepEqual(result.parsed.tp, [4112, 4107, 4092, 3047])
  })
})
