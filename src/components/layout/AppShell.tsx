import { BrokerAccountsProvider } from '../../context/BrokerAccountsContext'
import { NotificationsProvider } from '../../context/NotificationsContext'
import { HumanReviewProvider } from '../../context/HumanReviewContext'
import { AddTradingAccountProvider } from '../../context/AddTradingAccountContext'
import { PendingBrokerConnectionSync } from '../broker/PendingBrokerConnectionSync'
import { BrokerTerminalHealthSync } from '../broker/BrokerTerminalHealthSync'
import { AppLayout } from './AppLayout'
import { LiveChatProvider } from '../../context/LiveChatContext'
import { HumanReviewModal } from '../dashboard/HumanReviewModal'
import { useAuth } from '../../context/AuthContext'
import { useUserProfile } from '../../context/UserProfileContext'

/** Authenticated app shell: shared broker state + dashboard layout. */
export function AppShell() {
  const { loading: authLoading } = useAuth()
  const { loading: profileLoading } = useUserProfile()
  const deferAppBootstrap = authLoading || profileLoading

  return (
    <BrokerAccountsProvider enabled={!deferAppBootstrap}>
      {!deferAppBootstrap ? <PendingBrokerConnectionSync /> : null}
      {!deferAppBootstrap ? <BrokerTerminalHealthSync /> : null}
      <NotificationsProvider enabled={!deferAppBootstrap}>
        <HumanReviewProvider enabled={!deferAppBootstrap}>
          <AddTradingAccountProvider>
            <LiveChatProvider>
              <AppLayout />
              {!deferAppBootstrap ? <HumanReviewModal /> : null}
            </LiveChatProvider>
          </AddTradingAccountProvider>
        </HumanReviewProvider>
      </NotificationsProvider>
    </BrokerAccountsProvider>
  )
}
