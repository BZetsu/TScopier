/**
 * One-off FxSocket account health probe (no secrets printed).
 * Usage: npx ts-node -r dotenv/config src/diagnostics/checkFxsocketAccount.ts <fxsocket_account_id>
 */
import { FxsocketBrokerClient, hasFxsocketConfigured } from '../fxsocketClient'

async function main() {
  const id = process.argv[2]?.trim()
  if (!id) {
    console.error('usage: checkFxsocketAccount.ts <fxsocket_account_id>')
    process.exit(1)
  }
  if (!hasFxsocketConfigured()) {
    console.error('FXSOCKET_API_KEY not set')
    process.exit(1)
  }
  const client = new FxsocketBrokerClient('MT5')

  const results: Record<string, unknown> = { accountId: id }

  try {
    await client.checkConnect(id)
    results.checkConnect = 'ok'
  } catch (e) {
    results.checkConnect = e instanceof Error ? e.message : String(e)
  }

  try {
    const status = await client.mtStatus(id, 'MT5')
    results.mtStatus = status
  } catch (e) {
    results.mtStatusError = e instanceof Error ? e.message : String(e)
  }

  try {
    const quote = await client.quote(id, 'XAUUSDm')
    results.quoteXAUUSDm = quote
  } catch (e) {
    results.quoteError = e instanceof Error ? e.message : String(e)
  }

  console.log(JSON.stringify(results, null, 2))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
