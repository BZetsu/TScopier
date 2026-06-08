"use strict";
/** MT order comment parsing (worker-side, mirrors src/lib/tscopierComment.ts). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalIdMatchesPrefix = signalIdMatchesPrefix;
exports.parseTscopierComment = parseTscopierComment;
exports.tscopierCommentMatchesChannelSlug = tscopierCommentMatchesChannelSlug;
const TSCOPIER_PREFIX = 'TSCopier:';
function signalIdMatchesPrefix(signalId, prefix) {
    const norm = prefix.toLowerCase();
    if (norm.length !== 8 || !/^[a-f0-9]+$/.test(norm))
        return false;
    return signalId.toLowerCase().startsWith(norm);
}
/** Parse `TSCopier:ChannelSlug:abc12345` or `TSCopier:abc12345` from MT order comment. */
function parseTscopierComment(comment) {
    if (!comment?.trim())
        return null;
    const trimmed = comment.trim();
    if (!trimmed.startsWith(TSCOPIER_PREFIX))
        return null;
    const body = trimmed.slice(TSCOPIER_PREFIX.length);
    const segments = body.split(':').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0)
        return null;
    const id8From = (s) => {
        const m = s.match(/^([a-f0-9]{8})/i);
        return m ? m[1].toLowerCase() : null;
    };
    if (segments.length === 1) {
        const prefix = id8From(segments[0]);
        return prefix ? { channelSlug: null, signalIdPrefix: prefix } : null;
    }
    const firstPrefix = id8From(segments[0]);
    if (firstPrefix) {
        return { channelSlug: null, signalIdPrefix: firstPrefix };
    }
    const secondPrefix = id8From(segments[1] ?? '');
    if (secondPrefix) {
        return { channelSlug: segments[0], signalIdPrefix: secondPrefix };
    }
    return null;
}
/** True when comment belongs to this channel slug (case-insensitive). */
function tscopierCommentMatchesChannelSlug(comment, channelSlug) {
    const slug = channelSlug?.trim();
    if (!slug)
        return true;
    const parsed = parseTscopierComment(comment);
    if (!parsed?.channelSlug)
        return true;
    return parsed.channelSlug.toLowerCase() === slug.toLowerCase();
}
