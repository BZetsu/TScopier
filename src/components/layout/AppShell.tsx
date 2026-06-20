import { BrokerAccountsProvider } from '../../context/BrokerAccountsContext'
import { NotificationsProvider } from '../../context/NotificationsContext'
import { AddTradingAccountProvider } from '../../context/AddTradingAccountContext'
import { PendingBrokerConnectionSync } from '../broker/PendingBrokerConnectionSync'
import { AppLayout } from './AppLayout'
import { WelcomeModal } from '../onboarding/WelcomeModal'

/** Authenticated app shell: shared broker state + dashboard layout. */
export function AppShell() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrokerAccountsProvider>
        <PendingBrokerConnectionSync />
        <NotificationsProvider>
          <AddTradingAccountProvider>
            <AppLayout />
            <WelcomeModal />
          </AddTradingAccountProvider>
        </NotificationsProvider>
      </BrokerAccountsProvider>
    </div>
  )
}
