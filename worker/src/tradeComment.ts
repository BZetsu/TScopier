/**
 * MT order comment helpers. All copier trades use a `TSCopier:` prefix so open-
 * order reconciliation can find our legs; when a signal has a channel we embed
 * a short channel slug before the signal id.
 */

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
 * With channel: `TSCopier:ChannelSlug:abc12345`
 * Without: `TSCopier:abc12345`
 */
export function buildTscopierCommentPrefix(signalId: string, channelSlug?: string | null): string {
  const id8 = signalId.slice(0, 8)
  const slug = channelSlug?.trim()
  if (slug) return `TSCopier:${slug}:${id8}`
  return `TSCopier:${id8}`
}
