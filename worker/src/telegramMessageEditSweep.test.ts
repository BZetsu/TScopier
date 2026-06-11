import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findEditedSignals,
  messageTextChanged,
  shouldCheckMessageForEdit,
  snapshotsFromTelegramMessages,
  telegramEditDateSec,
} from './telegramMessageEditSweep'

describe('telegramMessageEditSweep', () => {
  it('messageTextChanged compares trimmed text', () => {
    assert.equal(messageTextChanged('Gold buy', 'Gold buy'), false)
    assert.equal(messageTextChanged('Gold buy', ' Gold buy '), false)
    assert.equal(messageTextChanged('Gold buy', 'Gold sell'), true)
  })

  it('shouldCheckMessageForEdit skips when edit_date unchanged and text matches', () => {
    assert.equal(
      shouldCheckMessageForEdit(
        { raw_message: 'Gold buy now', telegram_message_edit_date: 100 },
        { text: 'Gold buy now', editDateSec: 100 },
      ),
      false,
    )
  })

  it('shouldCheckMessageForEdit detects newer edit_date', () => {
    assert.equal(
      shouldCheckMessageForEdit(
        { raw_message: 'Gold buy now', telegram_message_edit_date: 100 },
        { text: 'Gold buy now\nSL 4490', editDateSec: 200 },
      ),
      true,
    )
  })

  it('findEditedSignals returns only changed messages', () => {
    const signals = [
      {
        id: 'sig-1',
        channel_id: 'ch-1',
        telegram_message_id: '42',
        raw_message: 'Gold buy now',
        telegram_message_edit_date: null,
      },
      {
        id: 'sig-2',
        channel_id: 'ch-1',
        telegram_message_id: '43',
        raw_message: 'unchanged',
        telegram_message_edit_date: null,
      },
    ]
    const telegram = new Map([
      ['42', { text: 'Gold buy now\nTP 4510', editDateSec: 500 }],
      ['43', { text: 'unchanged', editDateSec: null }],
    ])
    const edited = findEditedSignals(signals, telegram)
    assert.equal(edited.length, 1)
    assert.equal(edited[0]!.signal.id, 'sig-1')
    assert.equal(edited[0]!.rawMessage, 'Gold buy now\nTP 4510')
  })

  it('snapshotsFromTelegramMessages reads gramjs-like fields', () => {
    const map = snapshotsFromTelegramMessages([
      { id: 99, message: 'edited text', editDate: 1234 },
    ])
    assert.equal(map.get('99')?.text, 'edited text')
    assert.equal(map.get('99')?.editDateSec, 1234)
    assert.equal(telegramEditDateSec({ edit_date: 5678 }), 5678)
  })
})
