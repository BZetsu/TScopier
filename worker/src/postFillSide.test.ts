import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolvePostFillIsBuy } from './postFillSide'

test('resolvePostFillIsBuy: ticket sell wins over parsed buy (reverse)', () => {
  assert.equal(resolvePostFillIsBuy({
    direction: 'sell',
    parsedAction: 'buy',
    reverse: true,
  }), false)
})

test('resolvePostFillIsBuy: ticket buy wins over parsed sell', () => {
  assert.equal(resolvePostFillIsBuy({
    direction: 'buy',
    parsedAction: 'sell',
    reverse: false,
  }), true)
})

test('resolvePostFillIsBuy: missing direction + reverse flips parsed buy', () => {
  assert.equal(resolvePostFillIsBuy({
    direction: null,
    parsedAction: 'buy',
    reverse: true,
  }), false)
})
