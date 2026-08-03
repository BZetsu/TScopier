import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { shouldBlockNewEntryOnRevision } from './messageRevisionEntryGuard'

test('revision blocks new entry when already materialized', () => {
  assert.equal(
    shouldBlockNewEntryOnRevision({
      sameSignalRefresh: true,
      alreadyMaterialized: true,
    }),
    true,
  )
})

test('revision allows first entry when not yet materialized', () => {
  assert.equal(
    shouldBlockNewEntryOnRevision({
      sameSignalRefresh: true,
      alreadyMaterialized: false,
    }),
    false,
  )
})

test('blockNewEntry flag always blocks', () => {
  assert.equal(
    shouldBlockNewEntryOnRevision({
      sameSignalRefresh: false,
      blockNewEntry: true,
      alreadyMaterialized: false,
    }),
    true,
  )
})

test('normal entry is not blocked by guard', () => {
  assert.equal(
    shouldBlockNewEntryOnRevision({
      sameSignalRefresh: false,
      alreadyMaterialized: true,
    }),
    false,
  )
})
