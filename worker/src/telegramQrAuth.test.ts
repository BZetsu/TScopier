import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildQrStatusFromPending, formatQrLoginUrl } from './telegramQrAuth'

describe('formatQrLoginUrl', () => {
  it('builds tg:// login URL with base64url token', () => {
    const token = Buffer.from('hello-telegram-qr')
    const url = formatQrLoginUrl(token)
    assert.equal(url, `tg://login?token=${token.toString('base64url')}`)
  })

  it('accepts Uint8Array tokens', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const url = formatQrLoginUrl(bytes)
    assert.match(url, /^tg:\/\/login\?token=/)
  })
})

describe('buildQrStatusFromPending', () => {
  const qrUrl = 'tg://login?token=abc'
  const expiresAt = 1_700_000_000_000

  it('returns waiting with qr_url and expires_at', () => {
    const status = buildQrStatusFromPending({
      status: 'waiting',
      latestQrUrl: qrUrl,
      expiresAt,
    })
    assert.equal(status.status, 'waiting')
    assert.equal(status.qr_url, qrUrl)
    assert.equal(status.expires_at, new Date(expiresAt).toISOString())
  })

  it('returns requires_password with flag', () => {
    const status = buildQrStatusFromPending({
      status: 'requires_password',
      latestQrUrl: qrUrl,
      expiresAt,
    })
    assert.equal(status.status, 'requires_password')
    assert.equal(status.requires_password, true)
  })

  it('returns success with session and channels', () => {
    const status = buildQrStatusFromPending({
      status: 'success',
      result: { session_id: 'sess-1', channels: [{ id: 1 }] },
    })
    assert.equal(status.status, 'success')
    assert.equal(status.session_id, 'sess-1')
    assert.deepEqual(status.channels, [{ id: 1 }])
  })

  it('returns error with message', () => {
    const status = buildQrStatusFromPending({ status: 'error', error: 'expired' })
    assert.equal(status.status, 'error')
    assert.equal(status.error, 'expired')
  })
})
