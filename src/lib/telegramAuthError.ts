export const TELEGRAM_ALREADY_LINKED_ERROR = 'TELEGRAM_ALREADY_LINKED'

export type TelegramAuthErrorMessages = {
  telegramAlreadyLinked: string
  noPendingQr?: string
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
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}
