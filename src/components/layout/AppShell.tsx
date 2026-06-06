import { BrokerAccountsProvider } from '../../context/BrokerAccountsContext'
import { NotificationsProvider } from '../../context/NotificationsContext'
import { AppLayout } from './AppLayout'

/** Authenticated app shell: shared broker state + dashboard layout. */
export function AppShell() {
  return (
    <BrokerAccountsProvider>
      <NotificationsProvider>
        <AppLayout />
      </NotificationsProvider>
    </BrokerAccountsProvider>
  )
}
