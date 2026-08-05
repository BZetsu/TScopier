/**
 * Unit tests for Stripe entitlement picking (no Deno).
 * Mirrors supabase/functions/_shared/stripeSubscriptionSync.ts selection rules.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

type Plan = 'basic' | 'advanced'

function planRank(plan: Plan) {
  return plan === 'advanced' ? 2 : 1
}

function pickBest(
  rows: Array<{ id: string; plan: Plan; extra: number; status: string; created: number }>,
) {
  const candidates = rows.filter(r => ['active', 'trialing', 'past_due'].includes(r.status))
  candidates.sort((a, b) => {
    const planDiff = planRank(b.plan) - planRank(a.plan)
    if (planDiff) return planDiff
    const extraDiff = b.extra - a.extra
    if (extraDiff) return extraDiff
    return b.created - a.created
  })
  return candidates[0] ?? null
}

describe('stripe entitlement pickBest', () => {
  it('prefers Advanced over newer Basic', () => {
    const best = pickBest([
      { id: 'basic', plan: 'basic', extra: 0, status: 'active', created: 200 },
      { id: 'adv', plan: 'advanced', extra: 16, status: 'active', created: 100 },
    ])
    assert.equal(best?.id, 'adv')
  })

  it('among Advanced picks higher extras', () => {
    const best = pickBest([
      { id: 'a', plan: 'advanced', extra: 5, status: 'active', created: 200 },
      { id: 'b', plan: 'advanced', extra: 16, status: 'active', created: 100 },
    ])
    assert.equal(best?.id, 'b')
  })

  it('ignores canceled subscriptions', () => {
    const best = pickBest([
      { id: 'dead', plan: 'advanced', extra: 50, status: 'canceled', created: 300 },
      { id: 'live', plan: 'basic', extra: 0, status: 'active', created: 100 },
    ])
    assert.equal(best?.id, 'live')
  })
})
