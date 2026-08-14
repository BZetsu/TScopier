import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Api } from 'telegram/tl'
import {
  AuthService,
  NO_RESEND_AVAILABLE_ERROR,
  redactAuthLogValue,
  sentCodeStatus,
} from './authService'

type UpsertCall = {
  table: string
  payload: Record<string, unknown>
}

function fakeSupabase(upserts: UpsertCall[] = []) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null })
                },
              }
            },
          }
        },
        upsert(payload: Record<string, unknown>) {
          upserts.push({ table, payload })
          return Promise.resolve({ error: null })
        },
        delete() {
          return {
            eq() {
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
}

function fakeSessionManager() {
  return {
    setAuthGuard() {},
    prepareForAuth() {
      return Promise.resolve()
    },
    pauseForAuth() {
      return Promise.resolve()
    },
  }
}

function fakeClient() {
  return {
    connected: true,
    session: {
      save: () => 'session-secret',
    },
    connect() {
      return Promise.resolve()
    },
    disconnect() {
      return Promise.resolve()
    },
  }
}

describe('AuthService resendCode', () => {
  it('does not fabricate resend availability when Telegram omits nextType and timeout', () => {
    const status = sentCodeStatus({
      phoneCodeHash: 'hash-a',
      type: { className: 'auth.SentCodeTypeApp', length: 5 },
    } as never, 100_000)

    assert.equal(status.delivery, 'app')
    assert.equal(status.next_delivery, null)
    assert.equal(status.timeoutSeconds, null)
    assert.equal(status.resendAvailableAt, null)
    assert.equal(status.can_resend, false)
    assert.equal(status.canResend, false)
  })

  it('marks resend available only when Telegram returns nextType and timeout', () => {
    const status = sentCodeStatus({
      phoneCodeHash: 'hash-a',
      type: { className: 'auth.SentCodeTypeApp', length: 5 },
      nextType: { className: 'auth.CodeTypeSms' },
      timeout: 30,
    } as never, 100_000)

    assert.equal(status.next_delivery, 'sms')
    assert.equal(status.timeoutSeconds, 30)
    assert.equal(status.resendAvailableAt, 130_000)
    assert.equal(status.can_resend, true)
  })

  it('does not call Telegram before the returned timeout expires', async () => {
    let invokeCount = 0
    const service = new AuthService(
      fakeSupabase() as never,
      fakeSessionManager() as never,
      {
        now: () => 1_000,
        invoke: async () => {
          invokeCount += 1
          throw new Error('unexpected invoke')
        },
      },
    )
    ;(service as unknown as { pending: Map<string, unknown> }).pending.set('user-1', {
      method: 'phone',
      client: fakeClient(),
      phone: '+15551234567',
      phoneCodeHash: 'hash-a',
      delivery: 'app',
      nextDelivery: 'sms',
      timeoutSeconds: 42,
      resendAvailableAt: 43_000,
      canResend: true,
      codeLength: 5,
      createdAt: 1_000,
    })

    await assert.rejects(
      () => service.resendCode('user-1', '+15551234567'),
      /RESEND_WAIT_42/,
    )
    assert.equal(invokeCount, 0)
  })

  it('uses auth.ResendCode with the existing hash and replaces it with the returned hash', async () => {
    const upserts: UpsertCall[] = []
    const requests: unknown[] = []
    const service = new AuthService(
      fakeSupabase(upserts) as never,
      fakeSessionManager() as never,
      {
        now: () => 100_000,
        invoke: async (_client, request) => {
          requests.push(request)
          return {
            phoneCodeHash: 'hash-b',
            type: { className: 'auth.SentCodeTypeSms', length: 5 },
            nextType: { className: 'auth.CodeTypeCall' },
            timeout: 30,
          } as never
        },
      },
    )
    const pending = {
      method: 'phone',
      client: fakeClient(),
      phone: '+15551234567',
      phoneCodeHash: 'hash-a',
      delivery: 'app',
      nextDelivery: 'sms',
      timeoutSeconds: 42,
      resendAvailableAt: 99_000,
      canResend: true,
      codeLength: 5,
      createdAt: 1_000,
    }
    ;(service as unknown as { pending: Map<string, unknown> }).pending.set('user-1', pending)

    const result = await service.resendCode('user-1', '+15551234567')
    const request = requests[0] as Api.auth.ResendCode

    assert.equal(request.className, 'auth.ResendCode')
    assert.equal(request.phoneNumber, '+15551234567')
    assert.equal(request.phoneCodeHash, 'hash-a')
    assert.equal(pending.phoneCodeHash, 'hash-b')
    assert.equal(result.delivery, 'sms')
    assert.equal(result.next_delivery, 'call')
    assert.equal(result.can_resend, true)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'phoneCodeHash'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'phone_code_hash'), false)
    assert.equal(upserts.at(-1)?.payload.phone_code_hash, 'hash-b')
  })

  it('refuses resend locally when Telegram did not offer a resend path', async () => {
    let invokeCount = 0
    const service = new AuthService(
      fakeSupabase() as never,
      fakeSessionManager() as never,
      {
        now: () => 100_000,
        invoke: async () => {
          invokeCount += 1
          throw new Error('unexpected Telegram call')
        },
      },
    )
    const pending = {
      method: 'phone',
      client: fakeClient(),
      phone: '+15551234567',
      phoneCodeHash: 'hash-a',
      delivery: 'app',
      nextDelivery: null,
      timeoutSeconds: null,
      resendAvailableAt: null,
      canResend: false,
      codeLength: 5,
      createdAt: 100_000,
    }
    ;(service as unknown as { pending: Map<string, unknown> }).pending.set('user-1', pending)

    await assert.rejects(
      () => service.resendCode('user-1', '+15551234567'),
      new RegExp(NO_RESEND_AVAILABLE_ERROR),
    )
    assert.equal(invokeCount, 0)
    assert.equal(pending.phoneCodeHash, 'hash-a')
  })

  it('sendCode uses conservative server-side CodeSettings', async () => {
    const requests: unknown[] = []
    const service = new AuthService(
      fakeSupabase() as never,
      fakeSessionManager() as never,
      {
        buildClient: () => fakeClient() as never,
        now: () => 100_000,
        invoke: async (_client, request) => {
          requests.push(request)
          return {
            phoneCodeHash: 'hash-a',
            className: 'auth.SentCode',
            type: { className: 'auth.SentCodeTypeApp', length: 5 },
          } as never
        },
      },
    )

    const result = await service.sendCode('user-1', '+15551234567')
    const request = requests[0] as Api.auth.SendCode
    const settings = request.settings as Api.CodeSettings

    assert.equal(request.className, 'auth.SendCode')
    assert.equal(settings.allowFlashcall, false)
    assert.equal(settings.currentNumber, false)
    assert.equal(settings.allowAppHash, false)
    assert.equal(settings.allowMissedCall, false)
    assert.equal(settings.allowFirebase, false)
    assert.equal(result.can_resend, false)
    assert.equal(result.resend_available_at, null)
  })

  it('verifyCode uses the latest hash after resend replaces the old hash', async () => {
    const signInRequests: unknown[] = []
    const service = new AuthService(
      fakeSupabase() as never,
      fakeSessionManager() as never,
      {
        now: () => 100_000,
        invoke: async (_client, request) => {
          const telegramRequest = request as { className?: string }
          if (telegramRequest.className === 'auth.SignIn') {
            signInRequests.push(request)
            throw new Error('PHONE_CODE_INVALID')
          }
          return {} as never
        },
      },
    )
    ;(service as unknown as { pending: Map<string, unknown> }).pending.set('user-1', {
      method: 'phone',
      client: fakeClient(),
      phone: '+15551234567',
      phoneCodeHash: 'hash-b',
      delivery: 'sms',
      nextDelivery: 'call',
      timeoutSeconds: 30,
      resendAvailableAt: 130_000,
      canResend: true,
      codeLength: 5,
      createdAt: 100_000,
    })

    await assert.rejects(
      () => service.verifyCode('user-1', '+15551234567', '12345'),
      /PHONE_CODE_INVALID/,
    )
    assert.equal((signInRequests[0] as Api.auth.SignIn).phoneCodeHash, 'hash-b')
  })

  it('redacts sensitive auth log values while allowing safe code length and API error code telemetry', () => {
    assert.equal(redactAuthLogValue('phoneCodeHash', 'hash-a'), '[redacted]')
    assert.equal(redactAuthLogValue('auth_session_string', 'session-secret'), '[redacted]')
    assert.equal(redactAuthLogValue('password', 'secret'), '[redacted]')
    assert.equal(redactAuthLogValue('token', 'secret'), '[redacted]')
    assert.equal(redactAuthLogValue('phone', '+15551234567').startsWith('[phone:'), true)
    assert.equal(redactAuthLogValue('codeLength', 5), '5')
    assert.equal(redactAuthLogValue('apiErrorCode', 'PHONE_NUMBER_FLOOD'), 'PHONE_NUMBER_FLOOD')
  })
})
