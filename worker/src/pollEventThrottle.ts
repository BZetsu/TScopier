/**
 * Collapses repeated Telegram polling failures into one event row per window.
 *
 * While the MTProto socket is down, every channel on every poll tick reports the
 * same error (normally "Cannot send requests while disconnected"). Written
 * straight to `listener_events`, a six-second blip becomes six identical rows
 * and a real outage becomes tens of thousands: one production account produced
 * 21,411 of them in a day from a single unreadable channel.
 *
 * The first occurrence of an error is written immediately, so a fresh fault is
 * never hidden. Repeats inside the window are counted instead of written, and
 * the count — plus how many distinct sources those repeats came from — is
 * attached to the next row that is written.
 *
 * Keys deliberately exclude the channel: one outage covers every channel, so an
 * operator wants one row, not one per channel. The row therefore carries the
 * channel of the occurrence that wrote it; `repeat_sources` says how many other
 * distinct sources were folded in. Error text that embeds a channel name (for
 * example `Cannot find any entity corresponding to "@x"`) naturally keeps its
 * own key and stays per-channel — do not normalise that away.
 *
 * Known trade-off: a burst that ends inside a single window leaves one row that
 * does not say how often it repeated, because the count is only reported on the
 * next written row.
 *
 * This generalises `shouldEmitAuthKeyDupEvent` (`authKeyDuplicatedRecovery.ts`)
 * and the keyed suppression in `observability/criticalHealth.ts`; prefer this
 * class for new call sites.
 */

/** Default quiet period between two rows for the same error. */
export const POLL_EVENT_WINDOW_MS = 60_000

/** An entry untouched for this long is dropped so the map cannot grow forever. */
const ENTRY_TTL_MS = 15 * 60_000

/** Prune as soon as the map holds more than this, whether or not a key is new. */
const PRUNE_THRESHOLD = 256

interface ThrottleEntry {
  /** When a row was last written for this error. */
  lastEmitAt: number
  /** Repeats seen since that row and not yet reported. */
  suppressed: number
  /** Distinct sources (channels, callers) behind those suppressed repeats. */
  suppressedSources: Set<string>
  /** When this error was last seen at all, used only for pruning. */
  lastSeenAt: number
}

export interface PollEventDecision {
  /** Whether the caller should write a row now. */
  emit: boolean
  /** Repeats that were suppressed before this row; 0 when nothing was hidden. */
  repeats: number
  /** Distinct sources those repeats came from; 0 when nothing was hidden. */
  repeatSources: number
}

export class PollEventThrottle {
  private readonly entries = new Map<string, ThrottleEntry>()

  constructor(private readonly windowMs: number = POLL_EVENT_WINDOW_MS) {}

  /**
   * Decide whether this occurrence of `key` should be written.
   *
   * `sourceId` is optional and only used for reporting: it lets a written row
   * say how many distinct channels were folded into the repeats.
   *
   * The first call for a key writes. Later calls inside the window are counted
   * and skipped; the first call after the window writes again and carries the
   * number of skipped repeats and how many sources they came from.
   */
  shouldEmit(key: string, nowMs = Date.now(), sourceId?: string): PollEventDecision {
    if (this.entries.size > PRUNE_THRESHOLD) this.prune(nowMs)

    const entry = this.entries.get(key)
    if (!entry) {
      this.entries.set(key, {
        lastEmitAt: nowMs,
        suppressed: 0,
        suppressedSources: new Set(),
        lastSeenAt: nowMs,
      })
      return { emit: true, repeats: 0, repeatSources: 0 }
    }

    // A backwards wall-clock step must not pin the entry indefinitely.
    if (nowMs < entry.lastEmitAt) entry.lastEmitAt = nowMs
    entry.lastSeenAt = nowMs

    if (nowMs - entry.lastEmitAt >= this.windowMs) {
      const repeats = entry.suppressed
      const repeatSources = entry.suppressedSources.size
      entry.lastEmitAt = nowMs
      entry.suppressed = 0
      entry.suppressedSources = new Set()
      return { emit: true, repeats, repeatSources }
    }

    entry.suppressed += 1
    if (sourceId) entry.suppressedSources.add(sourceId)
    return { emit: false, repeats: 0, repeatSources: 0 }
  }

  /**
   * Forget every key, so the next failure writes immediately.
   *
   * Called when the connection is (re-)established: errors seen before a
   * reconnect belong to a different episode and must not silence the first
   * error of the next one.
   */
  clear(): void {
    this.entries.clear()
  }

  /** Number of tracked keys. Used by tests and cheap enough to keep public. */
  size(): number {
    return this.entries.size
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.lastSeenAt > ENTRY_TTL_MS) this.entries.delete(key)
    }
  }
}
