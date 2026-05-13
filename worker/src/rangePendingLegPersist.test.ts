import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isPostgresDuplicateKeyError } from './rangePendingLegPersist'

test('isPostgresDuplicateKeyError: code 23505', () => {
  assert.equal(isPostgresDuplicateKeyError({ code: '23505', message: 'x' }), true)
})

test('isPostgresDuplicateKeyError: message duplicate key', () => {
  assert.equal(
    isPostgresDuplicateKeyError({ message: 'duplicate key value violates unique constraint "foo"' }),
    true,
  )
})

test('isPostgresDuplicateKeyError: message unique constraint', () => {
  assert.equal(
    isPostgresDuplicateKeyError({ message: 'violates unique constraint range_pending_legs_active_step_unique' }),
    true,
  )
})

test('isPostgresDuplicateKeyError: unrelated error', () => {
  assert.equal(isPostgresDuplicateKeyError({ code: '42P01', message: 'relation missing' }), false)
  assert.equal(isPostgresDuplicateKeyError(null), false)
  assert.equal(isPostgresDuplicateKeyError('string'), false)
})
