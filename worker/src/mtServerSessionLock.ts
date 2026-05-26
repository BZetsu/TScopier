/**
 * Serialize MetatraderAPI ConnectEx / hard reconnect per broker server.
 * See supabase/functions/_shared/mtServerSessionLock.ts
 */

const chains = new Map<string, Promise<void>>()

function serverLockKey(platform: string, server: string): string {
  return `${String(platform ?? 'MT5').toUpperCase()}:${String(server ?? '').trim().toLowerCase()}`
}

export function withMtServerSessionLock<T>(
  platform: string,
  server: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = serverLockKey(platform, server)
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  chains.set(
    key,
    run.then(
      () => {},
      () => {},
    ),
  )
  return run
}

export function mtServerLockKey(platform: string, server: string): string {
  return serverLockKey(platform, server)
}

/** Pause between operations when multiple accounts share a server. */
export const MT_SAME_SERVER_GAP_MS = Math.max(
  800,
  Number(process.env.MT_SAME_SERVER_GAP_MS ?? 1500) || 1500,
)

export async function pauseIfSameMtServer(
  lastKey: string | null,
  platform: string,
  server: string | null | undefined,
): Promise<string> {
  const key = serverLockKey(platform, String(server ?? ''))
  if (lastKey && lastKey === key) {
    await new Promise(r => setTimeout(r, MT_SAME_SERVER_GAP_MS))
  }
  return key
}
