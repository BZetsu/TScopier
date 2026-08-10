export type AssistantTelegramLinkStage = 'idle' | 'phone' | 'code' | 'twoFa' | 'done'

export type AssistantTelegramLinkState = {
  stage: AssistantTelegramLinkStage
  /** Held in memory only for verify_code; never persisted to assistant history. */
  phone: string
  /** Last OTP while awaiting 2FA (needed for verify_code + password). Cleared on done/cancel. */
  code: string
  error: string
  busy: boolean
}

export const INITIAL_TELEGRAM_LINK_STATE: AssistantTelegramLinkState = {
  stage: 'idle',
  phone: '',
  code: '',
  error: '',
  busy: false,
}
