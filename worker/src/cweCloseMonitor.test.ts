import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isCweTriggered } from './cweCloseMonitor'

// A long ("buy") basket reaches the close target when the live BID rises to
// the threshold (we sell the basket at bid). A short basket reaches the
// close target when the live ASK falls to the threshold (we buy back at ask).
// Direction comparison is case-insensitive on the `direction` column.

test('isCweTriggered: buy fires when bid >= threshold', () => {
  // anchor=1850, +30 pips on XAU @ 2-digit (1 pip = $0.10) ⇒ threshold = 1853.
  assert.equal(isCweTriggered('buy', 1853, 1853, 1853.05), true)
  assert.equal(isCweTriggered('buy', 1853, 1855, 1855.05), true)
})

test('isCweTriggered: buy does NOT fire while bid < threshold', () => {
  assert.equal(isCweTriggered('buy', 1853, 1852.95, 1853.05), false)
  assert.equal(isCweTriggered('buy', 1853, 1840, 1840.1), false)
})

test('isCweTriggered: sell fires when ask <= threshold', () => {
  // anchor=1850, +30 pips short ⇒ threshold = 1847.
  assert.equal(isCweTriggered('sell', 1847, 1846.9, 1847), true)
  assert.equal(isCweTriggered('sell', 1847, 1845, 1845.1), true)
})

test('isCweTriggered: sell does NOT fire while ask > threshold', () => {
  assert.equal(isCweTriggered('sell', 1847, 1847.05, 1847.15), false)
  assert.equal(isCweTriggered('sell', 1847, 1860, 1860.1), false)
})

test('isCweTriggered: direction comparison is case-insensitive', () => {
  // The trades table stores direction as a plain 'buy' | 'sell' string but
  // historical rows or external imports may use uppercase. Defensive.
  assert.equal(isCweTriggered('Buy', 1853, 1853, 1853.05), true)
  assert.equal(isCweTriggered('SELL', 1847, 1846, 1846.1), true)
  // Anything that doesn't parse as 'buy' falls through to the sell branch.
  // We don't want a malformed direction to silently choose the wrong side,
  // but mixed-case 'Buy' / 'BUY' should still work.
  assert.equal(isCweTriggered('BUY', 1853, 1850, 1850.05), false)
})

test('isCweTriggered: rejects invalid inputs', () => {
  assert.equal(isCweTriggered('buy', 0, 1853, 1853.05), false)
  assert.equal(isCweTriggered('buy', NaN, 1853, 1853.05), false)
  assert.equal(isCweTriggered('buy', 1853, NaN, 1853.05), false)
  assert.equal(isCweTriggered('sell', 1847, 1847, NaN), false)
})

// Anchor-and-pips sanity check matching what the planner emits for XAUUSD.
// anchor=4711, +20 pips, pip=$0.10 ⇒ threshold = 4713. The BUY basket should
// close the moment bid touches 4713 (the live quote moved up by +$2 from anchor).
test('isCweTriggered: realistic XAUUSD buy basket closes at +20 pips profit', () => {
  const anchor = 4711
  const pip = 0.10
  const cwePips = 20
  const threshold = anchor + cwePips * pip
  assert.equal(threshold, 4713)
  assert.equal(isCweTriggered('buy', threshold, 4712.99, 4713.05), false)
  assert.equal(isCweTriggered('buy', threshold, 4713.0, 4713.05), true)
})
