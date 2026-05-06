import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { UserSessionManager } from './sessionManager'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const sessionManager = new UserSessionManager(supabase)

async function main() {
  console.log('[worker] TSCopier AI worker starting...')

  await sessionManager.loadAll()

  // Poll for new/changed sessions every 30 seconds
  setInterval(async () => {
    await sessionManager.syncSessions()
  }, 30_000)

  // Keep process alive
  process.on('SIGTERM', async () => {
    console.log('[worker] Shutting down...')
    await sessionManager.disconnectAll()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    console.log('[worker] Shutting down...')
    await sessionManager.disconnectAll()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('[worker] Fatal error:', err)
  process.exit(1)
})
