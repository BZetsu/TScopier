/** FxSocket-linked broker account (terminal UUID on broker_accounts). */
export function isFxsocketSessionUuid(fxsocketAccountId: string | null | undefined): boolean {
  const v = (fxsocketAccountId ?? '').trim()
  if (!v) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export function isFxsocketLinkedBroker(
  account: Pick<{ fxsocket_account_id?: string | null; is_active?: boolean }, 'fxsocket_account_id' | 'is_active'>,
): boolean {
  return Boolean(account.is_active) && isFxsocketSessionUuid(account.fxsocket_account_id)
}

/** @deprecated Use isFxsocketSessionUuid */
export function isMtSessionUuid(metaapiAccountId: string | null | undefined): boolean {
  return isFxsocketSessionUuid(metaapiAccountId)
}

/** Pre–FxSocket rows stored `ServerName|Login` in metaapi_account_id. */
export function isLegacyBrokerLink(metaapiAccountId: string | null | undefined): boolean {
  const v = (metaapiAccountId ?? '').trim()
  return v.length > 0 && v.includes('|')
}
