import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMessageEditDispatchRow,
  messageEditDirectionFlipped,
  messageEditDirectionFlippedFromActions,
  messageEditParseEligible,
  type ExistingSignalRow,
} from './telegramMessageEdit'

describe('telegramMessageEdit', () => {
  const existing: ExistingSignalRow = {
    id: 'sig-1',
    user_id: 'user-1',
    channel_id: 'ch-1',
    raw_message: 'Gold buy now',
    parsed_data: {
      action: 'buy',
      symbol: 'XAUUSD',
      entry_price: null,
      entry_zone_low: null,
      entry_zone_high: null,
      sl: null,
      tp: [],
      lot_size: null,
      raw_instruction: 'Gold buy now',
    } as ExistingSignalRow['parsed_data'],
    status: 'executed',
    parent_signal_id: null,
    is_modification: false,
    telegram_message_id: '42',
    reply_to_message_id: null,
    created_at: new Date().toISOString(),
  }

  it('messageEditParseEligible requires parsed status and SL or TP', () => {
    assert.equal(
      messageEditParseEligible({
        status: 'parsed',
        parsed: {
          action: 'buy',
          symbol: 'XAUUSD',
          entry_price: null,
          entry_zone_low: null,
          entry_zone_high: null,
          sl: null,
          tp: [4510],
          lot_size: null,
          confidence: 0,
          raw_instruction: 'Gold buy now @ 4500\nTP: 4510',
        },
        skip_reason: null,
      }),
      true,
    )
    assert.equal(
      messageEditParseEligible({
        status: 'parsed',
        parsed: {
          action: 'buy',
          symbol: 'XAUUSD',
          entry_price: 4500,
          entry_zone_low: null,
          entry_zone_high: null,
          sl: null,
          tp: [],
          lot_size: null,
          confidence: 0,
          raw_instruction: 'Gold buy now @ 4500',
        },
        skip_reason: null,
      }),
      false,
    )
  })

  it('messageEditDirectionFlipped detects buy to sell changes', () => {
    const parseResult = {
      status: 'parsed' as const,
      skip_reason: null,
      parsed: {
        action: 'sell',
        symbol: 'XAUUSD',
        entry_price: null,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: 4520,
        tp: [4500],
        lot_size: null,
        confidence: 0,
        raw_instruction: 'Gold sell now',
      },
    }
    assert.equal(messageEditDirectionFlipped(existing, parseResult), true)
    assert.equal(messageEditDirectionFlippedFromActions('buy', 'buy'), false)
    assert.equal(messageEditDirectionFlippedFromActions('buy', 'sell'), true)
  })

  it('buildMessageEditDispatchRow keeps signal id and sets parsed status', () => {
    const parseResult = {
      status: 'parsed',
      skip_reason: null,
      parsed: {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: 4500,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: 4490,
        tp: [4510],
        lot_size: null,
        confidence: 0,
        raw_instruction: 'Gold buy now @ 4500\nSL 4490\nTP: 4510',
      },
    }
    const row = buildMessageEditDispatchRow(existing, parseResult, parseResult.parsed.raw_instruction, {
      t_message_edit_received: 1,
    })
    assert.equal(row.id, 'sig-1')
    assert.equal(row.status, 'parsed')
    assert.equal(row.parsed_data?.tp?.[0], 4510)
  })
})
