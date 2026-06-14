export interface ConnectTradingAccountForm {
  label: string
  account_number: string
  account_password: string
  broker_server: string
}

export const emptyConnectTradingAccountForm: ConnectTradingAccountForm = {
  label: '',
  account_number: '',
  account_password: '',
  broker_server: '',
}
