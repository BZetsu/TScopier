import type { BrokerAccount } from '../types/database'
import { isMtSessionUuid } from './brokerLink'

/** Broker has a MetatraderAPI session that can be restored via reconnect. */
export function brokerCanReconnect(
  account: Pick<BrokerAccount, 'metaapi_account_id' | 'connection_status'>,
): boolean {
  return isMtSessionUuid(account.metaapi_account_id) && account.connection_status !== 'connected'
}

export function brokerNeedsPasswordForReconnect(message: string | undefined): boolean {
  return typeof message === 'string' && /session expired|not connected|password/i.test(message)
}
