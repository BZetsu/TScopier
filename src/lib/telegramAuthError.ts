export const TELEGRAM_ALREADY_LINKED_ERROR = 'TELEGRAM_ALREADY_LINKED'
export const NO_PENDING_PHONE_AUTH_ERROR = 'NO_PENDING_PHONE_AUTH'

export type TelegramAuthErrorMessages = {
  telegramAlreadyLinked: string
  noPendingQr?: string
  noPendingPhoneAuth?: string
}

export function isNoPendingPhoneAuthError(error: unknown): boolean {
  if (error === NO_PENDING_PHONE_AUTH_ERROR) return true
  if (typeof error !== 'string') return false
  return (
    /no pending auth flow/i.test(error)
    || /login session expired/i.test(error)
    || /call send_code first/i.test(error)
  )
}

export function resolveTelegramAuthError(
  error: unknown,
  fallback: string,
  messages: TelegramAuthErrorMessages,
): string {
  if (error === TELEGRAM_ALREADY_LINKED_ERROR) {
    return messages.telegramAlreadyLinked
  }
  if (error === 'NO_PENDING_QR') {
    return messages.noPendingQr ?? 'QR login expired. Please start again.'
  }
  if (isNoPendingPhoneAuthError(error)) {
    return messages.noPendingPhoneAuth
      ?? 'Login session expired. Go back and request a new verification code.'
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}
