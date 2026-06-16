import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BrokerSearchCompany } from './fxsocketBroker'
import { brokerSearchMatchScore, partitionBrokerSearchResults } from './brokerSearchResults'

const vantageCompanies: BrokerSearchCompany[] = [
  {
    companyName: 'Vantage Markets (Pty) Ltd',
    results: [
      { name: 'VantageMarkets-Demo' },
      { name: 'VantageMarkets-Live 2' },
    ],
  },
]

describe('brokerSearchResults', () => {
  it('brokerSearchMatchScore matches server names with trailing numbers', () => {
    assert.equal(brokerSearchMatchScore('VantageMarkets-Demo', 'VantageMarkets-Demo 2'), 90)
  })

  it('partitionBrokerSearchResults surfaces server hits for server queries', () => {
    const { serverHits, companyHits } = partitionBrokerSearchResults(
      'VantageMarkets-Demo 2',
      vantageCompanies,
    )
    assert.deepEqual(serverHits.map(hit => hit.serverName), ['VantageMarkets-Demo'])
    assert.equal(companyHits.length, 0)
  })
})
