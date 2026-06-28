/**
 * Deriv synthetic registry validation (run manually, not at runtime).
 *
 * Calls Deriv's public `active_symbols` WebSocket endpoint (no auth) and diffs
 * the live synthetic-index inventory against our canonical registry in
 * worker/src/derivSymbols.ts. Use it when Deriv adds/renames synthetics to spot
 * aliases our `normalizeDerivAlias` / `resolveDerivCanonicalToBrokerSymbol`
 * would miss.
 *
 * Usage (from worker/):
 *   npx tsx scripts/generateDerivSymbolRegistry.ts
 *
 * Optional app_id (Deriv assigns 1089 for docs/testing):
 *   DERIV_APP_ID=1089 npx tsx scripts/generateDerivSymbolRegistry.ts
 */

import {
  isDerivSyntheticSymbol,
  listDerivCanonicalSymbols,
  normalizeDerivAlias,
  resolveDerivCanonicalToBrokerSymbol,
} from '../src/derivSymbols'

const APP_ID = process.env.DERIV_APP_ID ?? '1089'
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`

interface ActiveSymbol {
  symbol: string
  display_name: string
  market: string
  submarket?: string
}

async function fetchActiveSymbols(): Promise<ActiveSymbol[]> {
  const ws = new WebSocket(WS_URL)
  return await new Promise<ActiveSymbol[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('Deriv active_symbols request timed out'))
    }, 20_000)

    ws.onopen = () => ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }))
    ws.onerror = (e) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket error: ${String(e)}`))
    }
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data))
        if (data.error) {
          clearTimeout(timer)
          ws.close()
          reject(new Error(data.error.message ?? 'Deriv API error'))
          return
        }
        if (Array.isArray(data.active_symbols)) {
          clearTimeout(timer)
          ws.close()
          resolve(data.active_symbols as ActiveSymbol[])
        }
      } catch (err) {
        clearTimeout(timer)
        reject(err as Error)
      }
    }
  })
}

async function main() {
  console.log(`Fetching Deriv active_symbols from ${WS_URL} …`)
  const all = await fetchActiveSymbols()
  const synthetics = all.filter(s => s.market === 'synthetic_index')
  const inventory = synthetics.map(s => s.symbol)
  const displayNames = synthetics.map(s => s.display_name)

  console.log(`\nLive synthetic indices: ${synthetics.length}`)

  const unmappable = synthetics.filter(
    s => !normalizeDerivAlias(s.symbol) && !normalizeDerivAlias(s.display_name),
  )
  if (unmappable.length) {
    console.log(`\n⚠️  ${unmappable.length} live synthetics our normalizer does NOT recognize:`)
    for (const s of unmappable) console.log(`   ${s.symbol.padEnd(12)} ${s.display_name}`)
  } else {
    console.log('\n✓ Every live synthetic is recognized by normalizeDerivAlias.')
  }

  const canonical = listDerivCanonicalSymbols()
  const unresolved = canonical.filter(
    c => isDerivSyntheticSymbol(c) && !resolveDerivCanonicalToBrokerSymbol(c, [...inventory, ...displayNames]),
  )
  if (unresolved.length) {
    console.log(`\nℹ️  ${unresolved.length} registry codes not present in this account's inventory:`)
    console.log(`   ${unresolved.join(', ')}`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
