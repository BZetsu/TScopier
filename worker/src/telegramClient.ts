import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'

/** Strip quotes/whitespace Railway/UI pastes sometimes leave on secret values. */
function envTrim(raw: string | undefined): string {
  return String(raw ?? '').trim().replace(/^['"]|['"]$/g, '')
}

function readApiId(): number {
  const n = Number.parseInt(envTrim(process.env.TELEGRAM_API_ID), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function readApiHash(): string {
  return envTrim(process.env.TELEGRAM_API_HASH)
}

/** Resolved at call time so health / buildClient see current process env. */
export function telegramApiCredentialsConfigured(): boolean {
  return readApiId() > 0 && readApiHash().length > 0
}

/** @deprecated Prefer reading via buildClient; kept for auth QR helpers. */
export const API_ID = readApiId()
/** @deprecated Prefer reading via buildClient; kept for auth QR helpers. */
export const API_HASH = readApiHash()

/**
 * Construct a TelegramClient with a fingerprint that matches what an official
 * Telegram desktop client sends. Avoids the generic GramJS defaults that
 * Telegram's anti-spam system flags on cold accounts from datacenter IPs.
 *
 * Reuse a single instance for the whole lifetime of an authenticated session
 * (auth + listener) — repeated connect/disconnect from datacenter IPs is one
 * of the strongest ban signals.
 */
export function buildClient(sessionString: string = ''): TelegramClient {
  const apiId = readApiId()
  const apiHash = readApiHash()
  if (!apiId || !apiHash) {
    throw new Error(
      'TELEGRAM_API_ID / TELEGRAM_API_HASH must be set in env '
      + '(Railway Backtest/Listener service variables — not Supabase Edge secrets)',
    )
  }
  const fp = sessionString.length > 8
    ? `${sessionString.slice(0, 4)}...${sessionString.slice(-4)}`
    : 'empty'
  console.log(`[telegram-conn] event=build_client session_fingerprint=${fp} api_id=${apiId}`)
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      retryDelay: 4000,
      // Manual recovery lives in UserListener.runWatchdog / forceReconnect.
      // Leaving autoReconnect on races with explicit disconnect+connect and is a
      // common trigger for Telegram AUTH_KEY_DUPLICATED after worker restarts.
      autoReconnect: false,
      useWSS: true,
      deviceModel: 'Desktop',
      systemVersion: 'Windows 10',
      appVersion: '5.6.3',
      langCode: 'en',
      systemLangCode: 'en',
      // Auto-sleep on FLOOD_WAIT under this many seconds instead of throwing.
      floodSleepThreshold: 60,
    }
  )

  const origConnect = client.connect.bind(client)
  client.connect = (async () => {
    const result = await origConnect()
    const sender = (client as unknown as { _sender?: { reconnect: () => void } })._sender
    if (sender?.reconnect) {
      const origReconnect = sender.reconnect.bind(sender)
      sender.reconnect = () => {
        if (!(client as unknown as { _autoReconnect?: boolean })._autoReconnect) return
        origReconnect()
      }
    }
    return result
  }) as typeof client.connect

  return client
}

/**
 * Wrap a raw `client.invoke(...)` call so that long FLOOD_WAIT_N errors
 * (above floodSleepThreshold) are handled with a transparent backoff
 * instead of bubbling up. Use for auth flows where we cannot afford a
 * hard error mid-handshake.
 */
export const TELEGRAM_SESSION_INVALID_CODE = 'TELEGRAM_SESSION_INVALID' as const

export class TelegramSessionInvalidError extends Error {
  readonly code = TELEGRAM_SESSION_INVALID_CODE

  constructor(message = 'Telegram session is no longer valid') {
    super(message)
    this.name = 'TelegramSessionInvalidError'
  }
}

export function isAuthKeyUnregistered(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return m.includes('AUTH_KEY_UNREGISTERED')
}

/** Telegram returns this when the same auth key is online twice (deploy overlap, double connect). */
export function isAuthKeyDuplicated(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return m.includes('AUTH_KEY_DUPLICATED')
}

export const TELEGRAM_MALFORMED_RPC_RESULT_CODE = 'GRAMJS_MALFORMED_RPC_RESULT' as const

export function isMalformedRpcResult(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null | undefined
  const code = String(e?.code ?? '')
  const message = String(e?.message ?? (err instanceof Error ? err.message : err ?? ''))
  return code === TELEGRAM_MALFORMED_RPC_RESULT_CODE
    || message.includes(TELEGRAM_MALFORMED_RPC_RESULT_CODE)
}

export function rethrowIfSessionInvalid(err: unknown): never {
  if (isAuthKeyUnregistered(err)) {
    throw new TelegramSessionInvalidError()
  }
  throw err
}

/**
 * The auth key is unusable, in either of its two shapes: Telegram reports
 * AUTH_KEY_UNREGISTERED directly, or an inner helper already converted it with
 * `rethrowIfSessionInvalid` (whose message no longer contains the raw code).
 * Callers recovering from a connection must treat both as "re-link required".
 */
export function isSessionInvalid(err: unknown): boolean {
  return isAuthKeyUnregistered(err) || err instanceof TelegramSessionInvalidError
}

export async function tgInvoke<T>(
  client: TelegramClient,
  req: unknown,
  depth = 0,
): Promise<T> {
  const maxFloodRetries = Math.max(0, Math.min(5, Number(process.env.TELEGRAM_FLOOD_MAX_RETRIES ?? 2)))
  const maxFloodWaitSec = Math.max(
    5,
    Math.min(300, Number(process.env.TELEGRAM_FLOOD_MAX_WAIT_SEC ?? 90)),
  )
  try {
    return (await client.invoke(req as never)) as T
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e)
    const flood = m.match(/FLOOD_WAIT_(\d+)/)
    if (flood) {
      const waitSec = parseInt(flood[1], 10)
      if (waitSec > maxFloodWaitSec || depth >= maxFloodRetries) {
        const err = new Error(`Telegram rate limit: wait ${waitSec} seconds, then try again.`)
        ;(err as Error & { cause?: unknown }).cause = e
        throw err
      }
      const sleepSec = waitSec + 2
      console.warn(`[telegram] FLOOD_WAIT_${flood[1]} — sleeping ${sleepSec}s before retry`)
      await new Promise(r => setTimeout(r, sleepSec * 1000))
      return tgInvoke<T>(client, req, depth + 1)
    }
    throw e
  }
}
