/**
 * Serialize MetatraderAPI ConnectEx / hard reconnect per broker server.
 * Concurrent ConnectEx to the same MT server can destabilize other live sessions
 * on that server (NullReference, false disconnects). Different logins on the same
 * server must not connect in parallel.
 */

const chains = new Map<string, Promise<void>>()

function serverLockKey(platform: string, server: string): string {
  return `${String(platform ?? "MT5").toUpperCase()}:${String(server ?? "").trim().toLowerCase()}`
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
