"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatQrLoginUrl = formatQrLoginUrl;
exports.buildQrStatusFromPending = buildQrStatusFromPending;
/** Build the tg:// URL encoded in Telegram QR login codes (GramJS/Telegram desktop). */
function formatQrLoginUrl(token) {
    const buf = Buffer.isBuffer(token) ? token : Buffer.from(token);
    return `tg://login?token=${buf.toString('base64url')}`;
}
function formatExpiresAt(expiresAt) {
    return expiresAt && expiresAt > 0 ? new Date(expiresAt).toISOString() : undefined;
}
/** Map in-memory QR pending auth to a poll API response. */
function buildQrStatusFromPending(pending) {
    if (pending.status === 'success' && pending.result) {
        return {
            status: 'success',
            session_id: pending.result.session_id,
            channels: pending.result.channels ?? [],
        };
    }
    if (pending.status === 'error') {
        return { status: 'error', error: pending.error ?? 'QR login failed' };
    }
    if (pending.status === 'requires_password') {
        return {
            status: 'requires_password',
            requires_password: true,
            qr_url: pending.latestQrUrl || undefined,
            expires_at: formatExpiresAt(pending.expiresAt),
        };
    }
    return {
        status: 'waiting',
        qr_url: pending.latestQrUrl,
        expires_at: formatExpiresAt(pending.expiresAt),
    };
}
