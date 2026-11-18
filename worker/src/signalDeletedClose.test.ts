import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { deletedTelegramMessageIds, isTelegramMessageEmpty } from './signalTelegramReconcile'

describe('telegram deleted message detection', () => {
  it('treats MessageEmpty as empty', () => {
    assert.equal(isTelegramMessageEmpty({ className: 'MessageEmpty', id: 12 }), true)
    assert.equal(
      isTelegramMessageEmpty({ className: 'Message', id: 12, message: 'BUY GOLD', date: 1 }),
      false,
    )
  })

  it('lists requested ids missing from a successful getMessages batch', () => {
    const deleted = deletedTelegramMessageIds(
      ['10', '11', '12'],
      [
        { className: 'Message', id: 10, message: 'BUY', date: 1 },
        { className: 'MessageEmpty', id: 11 },
      ],
    )
    assert.deepEqual(deleted.sort(), ['11', '12'])
  })
})
