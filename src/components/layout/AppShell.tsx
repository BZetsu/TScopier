import { lazy, Suspense, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BrokerAccountsProvider } from '../../context/BrokerAccountsContext'
import { NotificationsProvider } from '../../context/NotificationsContext'
import { HumanReviewProvider } from '../../context/HumanReviewContext'
import { AddTradingAccountProvider } from '../../context/AddTradingAccountContext'
import { PendingBrokerConnectionSync } from '../broker/PendingBrokerConnectionSync'
import { BrokerTerminalHealthSync } from '../broker/BrokerTerminalHealthSync'
import { AppLayout } from './AppLayout'
import { LiveChatProvider } from '../../context/LiveChatContext'
import { AssistantProvider } from '../../context/AssistantContext'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { HumanReviewModal } from '../dashboard/HumanReviewModal'
import { useNeedsWelcome } from '../../hooks/useNeedsWelcome'

const WelcomeModal = lazy(() =>
  import('../onboarding/WelcomeModal').then(m => ({ default: m.WelcomeModal })),
)

/** Authenticated app shell: shared broker state + dashboard layout. */
export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { needsWelcome, deferAppBootstrap } = useNeedsWelcome()
  const onDashboardRoute =
    location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/broker/')

  useEffect(() => {
    if (needsWelcome && !onDashboardRoute) {
      navigate('/dashboard', { replace: true })
    }
  }, [needsWelcome, onDashboardRoute, navigate])

  return (
    <BrokerAccountsProvider enabled={!deferAppBootstrap}>
      {!deferAppBootstrap ? <PendingBrokerConnectionSync /> : null}
      {!deferAppBootstrap ? <BrokerTerminalHealthSync /> : null}
      <NotificationsProvider enabled={!deferAppBootstrap}>
        <HumanReviewProvider enabled={!deferAppBootstrap}>
          <AddTradingAccountProvider>
            <LiveChatProvider>
              <AssistantProvider>
                <AppLayout />
                <AssistantPanel />
                {!deferAppBootstrap ? <HumanReviewModal /> : null}
                {needsWelcome ? (
                  <Suspense fallback={null}>
                    <WelcomeModal />
                  </Suspense>
                ) : null}
              </AssistantProvider>
            </LiveChatProvider>
          </AddTradingAccountProvider>
        </HumanReviewProvider>
      </NotificationsProvider>
    </BrokerAccountsProvider>
  )
}
