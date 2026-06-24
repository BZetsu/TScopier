import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GTMO_VIP_FIXTURES_DIR,
  evaluateChannelFixture,
  loadChannelFixtures,
} from './channelFixtures'

describe('GTMO VIP golden scenarios', () => {
  const fixtures = loadChannelFixtures(GTMO_VIP_FIXTURES_DIR)

  it('loads at least one fixture', () => {
    assert.ok(fixtures.length > 0, 'no GTMO VIP fixtures found')
  })

  for (const { file, fixture } of fixtures) {
    it(`${file}: ${fixture.name}`, () => {
      const { ok, failures } = evaluateChannelFixture(fixture)
      assert.ok(ok, `${file} parse mismatch:\n  ${failures.join('\n  ')}`)
    })
  }
})
