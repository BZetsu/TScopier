import type { NavigateFunction } from 'react-router-dom'
import type { PendingClientAction } from './assistantClient'

const NAV_ALLOWLIST = new Set([
  '/dashboard',
  '/copier-engine',
  '/account-config',
  '/channels',
  '/billing',
  '/contact-support',
  '/pricing',
])

export type AssistantActionHandlers = {
  navigate: NavigateFunction
  openAddTradingAccount: () => void
  openLiveChat: () => void
  refreshProfile: () => Promise<void> | void
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
        handlers.openAddTradingAccount()
        notes.push('Opened connect broker')
        break
      case 'open_telegram_link': {
        const path = String(action.args?.path ?? '/copier-engine')
        if (NAV_ALLOWLIST.has(path)) handlers.navigate(path)
        else handlers.navigate('/copier-engine')
        notes.push('Opened Copier Engine for Telegram link')
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
