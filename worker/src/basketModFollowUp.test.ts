import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mgmtSignalMatchesBasketSymbol,
  symbolsCompatibleForBasket,
  tryApplyBasketFollowUpToNewFill,
} from './basketModFollowUp'

describe('mgmtSignalMatchesBasketSymbol', () => {
  test('symbol-less modify matches any basket symbol', () => {
    assert.equal(
      mgmtSignalMatchesBasketSymbol({ action: 'modify', symbol: null }, 'XAUUSD'),
      true,
    )
    assert.equal(
      mgmtSignalMatchesBasketSymbol({ action: 'modify', symbol: '' }, 'XAUUSD'),
      true,
    )
  })

  test('symbol-specific modify still requires compatibility', () => {
    assert.equal(
      mgmtSignalMatchesBasketSymbol({ action: 'modify', symbol: 'XAUUSD' }, 'XAUUSD'),
      true,
    )
    assert.equal(
      mgmtSignalMatchesBasketSymbol({ action: 'modify', symbol: 'EURUSD' }, 'XAUUSD'),
      false,
    )
  })

  test('entry signals are not matched via mgmt helper without symbol', () => {
    assert.equal(
      symbolsCompatibleForBasket(null, 'XAUUSD'),
      false,
    )
  })
})

describe('tryApplyBasketFollowUpToNewFill', () => {
  test('prefers channel memory SL over stale entry signal SL', async () => {
    const modifies: Array<{ stoploss: number; takeprofit: number }> = []
    const api = {
      orderModify: async (_uuid: string, req: { stoploss: number; takeprofit: number }) => {
        modifies.push(req)
      },
    }

    const mockSupabase = {
      from(table: string) {
        if (table === 'signals') {
          let call = 0
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                maybeSingle: async () => {
                  if (call++ === 0) {
                    return {
                      data: {
                        channel_id: 'ch-1',
                        created_at: '2026-06-09T05:18:00Z',
                        parsed_data: {
                          action: 'sell',
                          symbol: 'XAUUSD',
                          sl: 4342,
                          tp: [4327, 4320, 4317],
                        },
                      },
                    }
                  }
                  return { data: null }
                },
                gte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          id: 'sig-entry',
                          created_at: '2026-06-09T05:18:00Z',
                          parsed_data: {
                            action: 'sell',
                            symbol: 'XAUUSD',
                            sl: 4342,
                            tp: [4327, 4320, 4317],
                          },
                        },
                        {
                          id: 'sig-modify',
                          created_at: '2026-06-09T05:20:00Z',
                          parsed_data: {
                            action: 'modify',
                            symbol: null,
                            sl: 4337,
                            tp: null,
                          },
                        },
                      ],
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'broker_accounts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { manual_settings: { tp_lots: [] } },
                }),
              }),
            }),
          }
        }
        if (table === 'trades') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [{ id: 'trade-1' }],
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          }
        }
        if (table === 'range_pending_legs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'channel_active_trade_params') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({
                    data: [{
                      symbol: 'XAUUSD',
                      stoploss: 4337,
                      tp_levels: [4327, 4320, 4317],
                    }],
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'trade_execution_logs') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    await tryApplyBasketFollowUpToNewFill(
      mockSupabase as never,
      api as never,
      {
        userId: 'user-1',
        basketSignalId: 'basket-1',
        brokerAccountId: 'broker-1',
        metaUuid: 'meta-1',
        symbol: 'XAUUSD',
        ticket: 12345,
        tradeRowId: 'trade-1',
        entryPrice: 4335,
        existingSl: 4342,
        existingTp: 4327,
        tpLots: [],
      },
    )

    assert.equal(modifies.length, 1)
    assert.equal(modifies[0]!.stoploss, 4337)
  })

  test('applies newest symbol-less modify when channel memory is absent', async () => {
    const modifies: Array<{ stoploss: number }> = []
    const api = {
      orderModify: async (_uuid: string, req: { stoploss: number }) => {
        modifies.push(req)
      },
    }

    const mockSupabase = {
      from(table: string) {
        if (table === 'signals') {
          return {
            select: () => ({
              eq: (_col: string, val: string) => {
                if (val === 'basket-1') {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        channel_id: 'ch-1',
                        created_at: '2026-06-09T05:18:00Z',
                        parsed_data: {
                          action: 'sell',
                          symbol: 'XAUUSD',
                          sl: 4342,
                          tp: [4327, 4320, 4317],
                        },
                      },
                    }),
                  }
                }
                return {
                  eq: () => ({
                    in: () => ({
                      gte: () => ({
                        order: () => ({
                          limit: async () => ({
                            data: [
                              {
                                id: 'sig-modify-new',
                                created_at: '2026-06-09T05:20:00Z',
                                parsed_data: {
                                  action: 'modify',
                                  symbol: null,
                                  sl: 4337,
                                },
                              },
                              {
                                id: 'sig-modify-old',
                                created_at: '2026-06-09T05:19:00Z',
                                parsed_data: {
                                  action: 'modify',
                                  symbol: null,
                                  sl: 4332,
                                },
                              },
                            ],
                          }),
                        }),
                      }),
                    }),
                  }),
                }
              },
            }),
          }
        }
        if (table === 'broker_accounts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { manual_settings: { tp_lots: [] } },
                }),
              }),
            }),
          }
        }
        if (table === 'trades') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: async () => ({ data: [{ id: 'trade-1' }] }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        if (table === 'range_pending_legs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'channel_active_trade_params') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({ data: [] }),
                }),
              }),
            }),
          }
        }
        if (table === 'trade_execution_logs') {
          return { insert: async () => ({ error: null }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    await tryApplyBasketFollowUpToNewFill(
      mockSupabase as never,
      api as never,
      {
        userId: 'user-1',
        basketSignalId: 'basket-1',
        brokerAccountId: 'broker-1',
        metaUuid: 'meta-1',
        symbol: 'XAUUSD',
        ticket: 12345,
        tradeRowId: 'trade-1',
        entryPrice: 4335,
        existingSl: 4342,
        existingTp: 4327,
        tpLots: [],
      },
    )

    assert.equal(modifies.length, 1)
    assert.equal(modifies[0]!.stoploss, 4337)
  })
})
