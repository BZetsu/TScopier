/** Classify MetatraderAPI / MT terminal connect failures for user-facing copy. */

export type BrokerConnectErrorKind =
  | 'wrong_password'
  | 'wrong_login'
  | 'wrong_server'
  | 'investor_password'
  | 'account_disabled'
  | 'session_expired'
  | 'unknown'

const WRONG_PASSWORD =
  /invalid password|wrong password|incorrect password|bad password|authorization failed|not authorized|invalid credentials|auth(?:entication)? failed|login failed|password (?:is )?invalid|invalid account password/i

const WRONG_LOGIN =
  /invalid account|unknown account|account not found|invalid login|wrong login|user not found|login (?:is )?invalid|invalid user|no such account|account disabled|account has been disabled|account blocked|trade account disabled/i

const WRONG_SERVER =
  /server not found|unknown server|invalid server|cannot find server|no such server|server (?:is )?invalid|host not found|server does not exist|cannot connect to (?:the )?server|failed to resolve server/i

const INVESTOR =
  /investor password|read[- ]?only|trade disabled|not allowed to trade|investor mode/i

const SESSION_EXPIRED =
  /session expired|client with id|client not found|unknown client|session not found|broker session is not connected|not connected|trading session expired|verifytradingready failed|keepsessionalive failed|heartbeat keepsessionalive failed/i

const BRIDGE_GLITCH =
  /object reference not set|nullreferenceexception|null reference|unexpected error|internal server error|an error occurred while handling|sequence contains no elements/i

export function isMtBridgeGlitchMessage(message: string | null | undefined): boolean {
  return BRIDGE_GLITCH.test(String(message ?? '').trim())
}

export function isSessionDropMessage(message: string | null | undefined): boolean {
  const m = String(message ?? '').trim()
  if (!m) return false
  if (isMtBridgeGlitchMessage(m)) return true
  return SESSION_EXPIRED.test(m)
}

export function classifyBrokerConnectError(raw: string | null | undefined): BrokerConnectErrorKind {
  const message = String(raw ?? '').trim()
  if (!message) return 'unknown'
  if (INVESTOR.test(message)) return 'investor_password'
  if (WRONG_PASSWORD.test(message)) return 'wrong_password'
  if (isMtBridgeGlitchMessage(message)) return 'session_expired'
  if (SESSION_EXPIRED.test(message)) return 'session_expired'
  if (WRONG_LOGIN.test(message)) return 'wrong_login'
  if (WRONG_SERVER.test(message)) return 'wrong_server'
  if (/account disabled|account has been disabled|account blocked|trade account disabled/i.test(message)) {
    return 'account_disabled'
  }
  return 'unknown'
}

export function isCredentialConnectError(kind: BrokerConnectErrorKind): boolean {
  return kind === 'wrong_password'
    || kind === 'wrong_login'
    || kind === 'wrong_server'
    || kind === 'investor_password'
    || kind === 'account_disabled'
}

export interface BrokerConnectErrorLabels {
  wrongPassword: string
  wrongLogin: string
  wrongServer: string
  investorPassword: string
  accountDisabled: string
  sessionExpired: string
  unknown: string
}

export function brokerConnectErrorText(
  kind: BrokerConnectErrorKind | null | undefined,
  rawMessage: string | null | undefined,
  labels: BrokerConnectErrorLabels,
): string {
  switch (kind ?? classifyBrokerConnectError(rawMessage)) {
    case 'wrong_password':
      return labels.wrongPassword
    case 'wrong_login':
      return labels.wrongLogin
    case 'wrong_server':
      return labels.wrongServer
    case 'investor_password':
      return labels.investorPassword
    case 'account_disabled':
      return labels.accountDisabled
    case 'session_expired':
      if (isMtBridgeGlitchMessage(rawMessage)) {
        return labels.sessionExpired
      }
      return labels.sessionExpired
    case 'unknown':
      return rawMessage?.trim() || labels.unknown
    default:
      return rawMessage?.trim() || labels.unknown
  }
}

export function brokerNeedsPasswordForReconnectMessage(message: string | undefined): boolean {
  if (!message?.trim()) return false
  const kind = classifyBrokerConnectError(message)
  if (isCredentialConnectError(kind)) return false
  return kind === 'session_expired'
    || (/session expired|not connected|broker session/i.test(message) && kind === 'unknown')
}

export function brokerReconnectBannerText(
  brokers: Array<{
    label: string
    connection_error_kind?: BrokerConnectErrorKind | string | null
    connection_error_message?: string | null
  }>,
  labels: BrokerConnectErrorLabels & {
    droppedOne: string
    droppedMany: string
  },
): string {
  if (brokers.length === 0) return ''
  if (brokers.length === 1) {
    const b = brokers[0]!
    const kind = (b.connection_error_kind as BrokerConnectErrorKind | null)
      ?? classifyBrokerConnectError(b.connection_error_message)
    if (kind === 'session_expired' && !b.connection_error_message?.trim()) return labels.droppedOne
    return `${b.label}: ${brokerConnectErrorText(kind, b.connection_error_message, labels)}`
  }
  return labels.droppedMany.replace('{count}', String(brokers.length))
}

export function brokerConnectErrorLabelsFromI18n(bl: {
  connectErrorWrongPassword: string
  connectErrorWrongLogin: string
  connectErrorWrongServer: string
  connectErrorInvestorPassword: string
  connectErrorAccountDisabled: string
  connectErrorSessionExpired: string
  connectErrorUnknown: string
}): BrokerConnectErrorLabels {
  return {
    wrongPassword: bl.connectErrorWrongPassword,
    wrongLogin: bl.connectErrorWrongLogin,
    wrongServer: bl.connectErrorWrongServer,
    investorPassword: bl.connectErrorInvestorPassword,
    accountDisabled: bl.connectErrorAccountDisabled,
    sessionExpired: bl.connectErrorSessionExpired,
    unknown: bl.connectErrorUnknown,
  }
}
