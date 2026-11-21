/**
 * MT order comment helpers. All copier trades use a `UniCopier:` prefix so open-
 * order reconciliation can find our legs; when a signal has a channel we embed
 * a short channel slug before the signal id.
 */

import { TSCOPIER_COMMENT_PREFIX } from './tscopierComment'

/** Max length of the channel slug segment (broker-safe alphanumeric). */
export const CHANNEL_COMMENT_SLUG_MAX = 12

/** Resolve the human label used for the comment slug. */
export function resolveChannelLabelForComment(
  displayName?: string | null,
  channelUsername?: string | null,
): string {
  const dn = displayName?.trim()
  if (dn) return dn
  return channelUsername?.trim().replace(/^@/, '') ?? ''
}

/**
 * Strip to characters MT terminals accept in comments (letters and digits only).
 */
export function sanitizeChannelCommentSlug(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, '')
  if (!trimmed) return ''
  const alnum = trimmed.replace(/[^a-zA-Z0-9]/g, '')
  if (alnum.length >= 2) return alnum.slice(0, CHANNEL_COMMENT_SLUG_MAX)
  const collapsed = trimmed.replace(/[^a-zA-Z0-9]+/g, '')
  return collapsed.slice(0, CHANNEL_COMMENT_SLUG_MAX) || 'ch'
}

/**
 * Prefix for planner / OrderSend comments.
 * With channel: `UniCopier:ChannelSlug:abc12345`
 * Without: `UniCopier:abc12345`
 */
export function buildTscopierCommentPrefix(signalId: string, channelSlug?: string | null): string {
  const id8 = signalId.slice(0, 8)
  const slug = channelSlug?.trim()
  if (slug) return `${TSCOPIER_COMMENT_PREFIX}${slug}:${id8}`
  return `${TSCOPIER_COMMENT_PREFIX}${id8}`
}

export type OrderCommentsManual = { order_comments_enabled?: boolean } | null | undefined

/** Default on — only explicit `false` disables MT order comments. */
export function areOrderCommentsEnabled(manual?: OrderCommentsManual): boolean {
  return manual?.order_comments_enabled !== false
}

/**
 * Resolve the comment prefix for a broker after manual settings are known.
 * Returns empty string when order comments are disabled for that channel config.
 */
export function resolveTscopierCommentPrefix(
  signalId: string,
  channelSlug?: string | null,
  manual?: OrderCommentsManual,
  overridePrefix?: string | null,
): string {
  if (!areOrderCommentsEnabled(manual)) return ''
  if (overridePrefix != null && overridePrefix !== '') return overridePrefix
  return buildTscopierCommentPrefix(signalId, channelSlug)
}

/** Append a planner suffix (`:tp1`, `:rg2.tp`, …); empty when comments are off. */
export function appendOrderCommentSuffix(prefix: string, suffix: string): string {
  if (!prefix) return ''
  return `${prefix}${suffix}`
}

/**
 * 0-based take-profit level from an order comment (`:tp1` → 0, `:rg2.tp3` → 2).
 * Used so teaser follow-ups attach ladder prices to the planned leg, not by open time.
 */
export function parseOrderCommentTpIndex(comment: string | null | undefined): number | null {
  if (!comment) return null
  const m = String(comment).toLowerCase().match(/(?:^|:)(?:rg\d+\.)?tp(\d+)\b/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1) return null
  return Math.floor(n) - 1
}

/** Comment for basket refresh OrderSend when a leg must be re-opened. */
export function buildBasketRefreshComment(signalId: string, manual?: OrderCommentsManual): string {
  if (!areOrderCommentsEnabled(manual)) return ''
  return `${TSCOPIER_COMMENT_PREFIX}${signalId.slice(0, 8)}:refresh`
}
