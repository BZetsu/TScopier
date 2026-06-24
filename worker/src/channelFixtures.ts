/**
 * Offline golden-scenario harness for channel parsing.
 *
 * Loads JSON fixtures (raw Telegram message + expected parse) and runs them
 * through `parseChannelMessageSync` with default keywords — no Supabase needed,
 * so it runs in CI and via `replayChannelParse --fixtures`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_CHANNEL_KEYWORDS,
  parseChannelMessageSync,
  type ChannelLexiconRow,
} from './parseSignal'

export type ChannelFixtureExpect = {
  status?: string
  action?: string
  symbol?: string | null
  sl?: number
  entry_price?: number
  tp?: number[]
  tpCount?: number
}

export type ChannelFixture = {
  name: string
  message: string
  expect: ChannelFixtureExpect
}

export const GTMO_VIP_FIXTURES_DIR = path.join(
  __dirname,
  '..',
  'fixtures',
  'channels',
  'gtmo-vip',
)

export function loadChannelFixtures(dir: string): Array<{ file: string; fixture: ChannelFixture }> {
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(file => ({
      file,
      fixture: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as ChannelFixture,
    }))
}

export function evaluateChannelFixture(fixture: ChannelFixture): {
  ok: boolean
  failures: string[]
  result: ReturnType<typeof parseChannelMessageSync>
} {
  const lexicon: ChannelLexiconRow | null = null
  const result = parseChannelMessageSync(fixture.message, DEFAULT_CHANNEL_KEYWORDS, lexicon)
  const expect = fixture.expect ?? {}
  const parsed = result.parsed
  const failures: string[] = []

  if (expect.status != null && result.status !== expect.status) {
    failures.push(`status: expected ${expect.status}, got ${result.status}`)
  }
  if (expect.action != null && parsed.action !== expect.action) {
    failures.push(`action: expected ${expect.action}, got ${parsed.action}`)
  }
  if (expect.symbol !== undefined && parsed.symbol !== expect.symbol) {
    failures.push(`symbol: expected ${String(expect.symbol)}, got ${String(parsed.symbol)}`)
  }
  if (expect.sl != null && parsed.sl !== expect.sl) {
    failures.push(`sl: expected ${expect.sl}, got ${String(parsed.sl)}`)
  }
  if (expect.entry_price != null && parsed.entry_price !== expect.entry_price) {
    failures.push(`entry_price: expected ${expect.entry_price}, got ${String(parsed.entry_price)}`)
  }
  if (expect.tp != null) {
    const tp = Array.isArray(parsed.tp) ? parsed.tp : []
    if (JSON.stringify(tp) !== JSON.stringify(expect.tp)) {
      failures.push(`tp: expected ${JSON.stringify(expect.tp)}, got ${JSON.stringify(tp)}`)
    }
  }
  if (expect.tpCount != null) {
    const tp = Array.isArray(parsed.tp) ? parsed.tp : []
    if (tp.length !== expect.tpCount) {
      failures.push(`tpCount: expected ${expect.tpCount}, got ${tp.length}`)
    }
  }

  return { ok: failures.length === 0, failures, result }
}
