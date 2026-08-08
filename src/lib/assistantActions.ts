import type { NavigateFunction } from 'react-router-dom'
import type { PendingClientAction } from './assistantClient'
import type { AssistantBrokerConnectPrefill } from './assistantBrokerConnect'

const NAV_ALLOWLIST = new Set([
  '/dashboard',
  '/copier-engine',
  '/account-config',
  '/channels',
  '/backtest',
  '/billing',
  '/contact-support',
  '/pricing',
])

export type AssistantActionHandlers = {
  navigate: NavigateFunction
  openAddTradingAccount: () => void
  openLiveChat: () => void
  refreshProfile: () => Promise<void> | void
  startTelegramLinkFlow?: () => void
  startBrokerConnectFlow?: (prefill?: AssistantBrokerConnectPrefill | null) => void
}

function prefillFromAction(action: PendingClientAction): AssistantBrokerConnectPrefill {
  const args = action.args ?? {}
  const platform = args.platform === 'MT4' || args.platform === 'MT5' ? args.platform : undefined
  return {
    platform,
    account_login: args.account_login != null ? String(args.account_login) : undefined,
    broker_server: args.broker_server != null ? String(args.broker_server) : undefined,
    label: args.label != null ? String(args.label) : undefined,
  }
}

/** Run allowlisted client-side actions returned by the assistant. */
export function runPendingClientActions(
  actions: PendingClientAction[],
  handlers: AssistantActionHandlers,
): string[] {
  const notes: string[] = []
  for (const action of actions) {
    switch (action.type) {
      case 'open_connect_broker':
      case 'start_broker_connect':
        if (handlers.startBrokerConnectFlow) {
          handlers.startBrokerConnectFlow(prefillFromAction(action))
          notes.push('Started in-chat broker connect')
        } else {
          handlers.openAddTradingAccount()
          notes.push('Opened connect broker')
        }
        break
      case 'start_telegram_link':
        handlers.startTelegramLinkFlow?.()
        notes.push('Started in-chat Telegram link')
        break
      case 'open_telegram_link': {
        if (handlers.startTelegramLinkFlow) {
          handlers.startTelegramLinkFlow()
          notes.push('Started in-chat Telegram link')
        } else {
          const path = String(action.args?.path ?? '/copier-engine')
          if (NAV_ALLOWLIST.has(path)) handlers.navigate(path)
          else handlers.navigate('/copier-engine')
          notes.push('Opened Copier Engine for Telegram link')
        }
        break
      }
      case 'navigate': {
        const path = String(action.args?.path ?? '')
        if (NAV_ALLOWLIST.has(path)) {
          handlers.navigate(path)
          notes.push(`Navigated to ${path}`)
        }
        break
      }
      case 'open_live_chat':
        handlers.openLiveChat()
        notes.push('Opened live chat')
        break
      case 'propose_config_change': {
        const path = '/account-config'
        handlers.navigate(path)
        notes.push(action.summary || 'Opened Configuration to review changes')
        break
      }
      default:
        break
    }
  }
  return notes
}

export function isNavigatePathAllowed(path: string): boolean {
  return NAV_ALLOWLIST.has(path)
}
