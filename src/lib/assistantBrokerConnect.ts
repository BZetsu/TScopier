export type AssistantBrokerConnectPrefill = {
  platform?: 'MT4' | 'MT5'
  account_login?: string
  broker_server?: string
  label?: string
}

export type AssistantBrokerConnectState = {
  active: boolean
  busy: boolean
  error: string
  platform: 'MT4' | 'MT5'
  account_login: string
  broker_server: string
  label: string
}

export const INITIAL_BROKER_CONNECT_STATE: AssistantBrokerConnectState = {
  active: false,
  busy: false,
  error: '',
  platform: 'MT5',
  account_login: '',
  broker_server: '',
  label: '',
}

export function brokerConnectFromPrefill(
  prefill?: AssistantBrokerConnectPrefill | null,
): AssistantBrokerConnectState {
  const platform = prefill?.platform === 'MT4' ? 'MT4' : 'MT5'
  return {
    ...INITIAL_BROKER_CONNECT_STATE,
    active: true,
    platform,
    account_login: String(prefill?.account_login ?? '').trim(),
    broker_server: String(prefill?.broker_server ?? '').trim(),
    label: String(prefill?.label ?? '').trim(),
  }
}
