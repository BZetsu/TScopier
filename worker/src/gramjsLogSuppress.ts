/**
 * Suppresses GramJS internal flood-wait INFO noise from console.log.
 * Flood waits are handled internally by GramJS — individual "Sleeping for Xs
 * on flood wait" lines provide no operational value (83% of log volume in
 * production). Instead, we aggregate counts per 60s window and emit a single
 * consolidated line.
 *
 * Must be imported first in the entry point so the patch is in place before
 * any TelegramClient instances are created at runtime.
 */

const FLOOD_WAIT_RE = /Sleeping for (\d+)s on flood wait/

const originalLog = console.log

let windowStart = Date.now()
let count = 0
let totalSec = 0
let minSec = Infinity
let maxSec = 0

console.log = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '')

  if (FLOOD_WAIT_RE.test(msg)) {
    const m = msg.match(FLOOD_WAIT_RE)
    if (m) {
      const sec = parseInt(m[1], 10)
      count++
      totalSec += sec
      if (sec < minSec) minSec = sec
      if (sec > maxSec) maxSec = sec
    }
    return
  }

  originalLog.apply(console, args)
}

setInterval(() => {
  const now = Date.now()
  if (count > 0) {
    const avg = Math.round(totalSec / count)
    const elapsedSec = ((now - windowStart) / 1000).toFixed(0)
    originalLog(
      `[telegram] aggregated_flood_wait count=${count} window=${elapsedSec}s`
      + ` avg=${avg}s min=${minSec}s max=${maxSec}s`,
    )
  }
  windowStart = now
  count = 0
  totalSec = 0
  minSec = Infinity
  maxSec = 0
}, 60_000).unref()
