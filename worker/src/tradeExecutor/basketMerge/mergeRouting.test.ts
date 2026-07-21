import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { revisionRefreshWithoutOpenBasketOutcome } from './mergeRouting'

test('revision refresh without open basket is handled and does not reopen entry', () => {
  assert.deepEqual(
    revisionRefreshWithoutOpenBasketOutcome(true),
    { handled: true, success: false },
  )
})

test('non-revision parameter follow-up without open basket may fall through', () => {
  assert.deepEqual(
    revisionRefreshWithoutOpenBasketOutcome(false),
    { handled: false },
  )
})
