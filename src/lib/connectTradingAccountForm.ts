export interface ConnectTradingAccountForm {
  label: string
  platform: 'MT4' | 'MT5'
  account_number: string
  account_password: string
  broker_server: string
  remember_password: boolean
}

export const emptyConnectTradingAccountForm: ConnectTradingAccountForm = {
  label: '',
  platform: 'MT5',
  account_number: '',
  account_password: '',
  broker_server: '',
  remember_password: false,
}
