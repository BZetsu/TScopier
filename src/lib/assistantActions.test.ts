import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isNavigatePathAllowed, runPendingClientActions } from './assistantActions'

describe('assistantActions navigate allowlist', () => {
  it('allows known app paths', () => {
    for (const path of [
      '/dashboard',
      '/copier-engine',
      '/brokers',
      '/account-config', // legacy → allowed via normalize to /brokers
      '/channels',
      '/backtest',
      '/billing',
      '/contact-support',
      '/pricing',
    ]) {
      assert.equal(isNavigatePathAllowed(path), true)
    }
  })

  it('rejects unknown paths', () => {
    assert.equal(isNavigatePathAllowed('/admin'), false)
    assert.equal(isNavigatePathAllowed('https://evil.example'), false)
    assert.equal(isNavigatePathAllowed('/dashboard/../admin'), false)
  })

  it('open_broker_config requests configure modal', () => {
    const navigated: string[] = []
    const configured: string[] = []
    runPendingClientActions(
      [
        {
          type: 'open_broker_config',
          summary: 'Open config',
          args: { broker_account_id: 'broker-1' },
        },
      ],
      {
        navigate: (path) => {
          navigated.push(String(path))
        },
        openAddTradingAccount: () => {},
        openLiveChat: () => {},
        refreshProfile: () => {},
        requestConfigureBroker: (id) => {
          configured.push(id)
        },
      },
    )
    assert.deepEqual(configured, ['broker-1'])
    assert.deepEqual(navigated, [])
  })

  it('legacy account-config navigate goes to /brokers', () => {
    const navigated: string[] = []
    runPendingClientActions(
      [{ type: 'navigate', summary: 'Go', args: { path: '/account-config' } }],
      {
        navigate: (path) => {
          navigated.push(String(path))
        },
        openAddTradingAccount: () => {},
        openLiveChat: () => {},
        refreshProfile: () => {},
      },
    )
    assert.deepEqual(navigated, ['/brokers'])
  })
})
