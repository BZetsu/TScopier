import { BrokerAccountsProvider } from '../../context/BrokerAccountsContext'
import { NotificationsProvider } from '../../context/NotificationsContext'
import { AddTradingAccountProvider } from '../../context/AddTradingAccountContext'
import { AppLayout } from './AppLayout'

/** Authenticated app shell: shared broker state + dashboard layout. */
export function AppShell() {
  return (
    <BrokerAccountsProvider>
      <NotificationsProvider>
        <AddTradingAccountProvider>
          <AppLayout />
        </AddTradingAccountProvider>
      </NotificationsProvider>
    </BrokerAccountsProvider>
  )
}
