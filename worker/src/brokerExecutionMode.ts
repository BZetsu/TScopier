import type { AccountSummary, FxsocketMtStatus, FxsocketTerminalStatus, OrderModifyArgs, OrderResult, OrderSendArgs, QuoteResult, SymbolParams } from './fxsocketClient'

export type BrokerMode = 'live' | 'simulator'

export interface BrokerExecutionCapability {
  load_test_enabled: boolean
  broker_mode: BrokerMode
  live_broker_execution_enabled: boolean
  simulator_enforced: boolean
  environment: string
}

let selectedCapability: BrokerExecutionCapability | null = null

function envBool(raw: string | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true'
}

function safeEnvironment(env: NodeJS.ProcessEnv): string {
  return String(env.NODE_ENV ?? 'production').trim().toLowerCase() || 'production'
}

function assertNoLiveBrokerCredentials(env: NodeJS.ProcessEnv): void {
  const liveCredentialVars = [
    'FXSOCKET_API_KEY',
    'FXSOCKET_BASE_URL',
    'MT4API_BASIC_USER',
    'MT4API_BASIC_PASSWORD',
    'BROKER_PASSWORD',
    'BROKER_LOGIN',
  ]
  const present = liveCredentialVars.filter(name => String(env[name] ?? '').trim())
  if (present.length > 0) {
    throw new Error(`Broker simulator mode refuses live broker credential variables: ${present.join(', ')}`)
  }
}

export function buildBrokerExecutionCapability(env: NodeJS.ProcessEnv = process.env): BrokerExecutionCapability {
  const loadTest = envBool(env.LOAD_TEST_MODE)
  const simulatorRequested = envBool(env.BROKER_SIMULATOR_MODE)
  const environment = safeEnvironment(env)

  if (simulatorRequested && environment === 'production') {
    throw new Error('BROKER_SIMULATOR_MODE=true is not allowed with NODE_ENV=production')
  }
  if (loadTest && !simulatorRequested) {
    throw new Error('LOAD_TEST_MODE=true requires BROKER_SIMULATOR_MODE=true')
  }
  if (simulatorRequested && !loadTest) {
    throw new Error('BROKER_SIMULATOR_MODE=true requires LOAD_TEST_MODE=true')
  }
  if (simulatorRequested) {
    assertNoLiveBrokerCredentials(env)
    return Object.freeze({
      load_test_enabled: true,
      broker_mode: 'simulator',
      live_broker_execution_enabled: false,
      simulator_enforced: true,
      environment,
    })
  }

  return Object.freeze({
    load_test_enabled: false,
    broker_mode: 'live',
    live_broker_execution_enabled: true,
    simulator_enforced: false,
    environment,
  })
}

export function initializeBrokerExecutionCapability(env: NodeJS.ProcessEnv = process.env): BrokerExecutionCapability {
  selectedCapability = buildBrokerExecutionCapability(env)
  return selectedCapability
}

export function getBrokerExecutionCapability(): BrokerExecutionCapability {
  if (!selectedCapability) selectedCapability = buildBrokerExecutionCapability()
  return selectedCapability
}

export function isBrokerSimulatorEnforced(): boolean {
  const cap = getBrokerExecutionCapability()
  return cap.broker_mode === 'simulator'
    && cap.simulator_enforced === true
    && cap.live_broker_execution_enabled === false
}

export function resetBrokerExecutionCapabilityForTests(): void {
  selectedCapability = null
}

export class FxsocketNoSendSimulator {
  readonly simulated = true
  private nextTicket = 900000
  private orders = new Map<string, OrderResult[]>()
  private platformCache = new Map<string, 'MT4' | 'MT5'>()

  seedPlatformCache(id: string, platform: 'MT4' | 'MT5'): void {
    this.platformCache.set(String(id), platform)
  }

  async connectEx(args: { id: string }): Promise<string> {
    return String(args.id || `sim-${this.nextTicket++}`)
  }

  async connectByToken(_id: string): Promise<void> {}
  async ensureConnected(_id: string): Promise<void> {}
  async keepSessionAlive(_id: string): Promise<boolean> { return true }
  async keepSessionAliveDetailed(_id: string): Promise<'alive'> { return 'alive' }
  async verifyTradingReady(_id: string): Promise<boolean> { return true }
  async disconnect(_id: string): Promise<void> {}
  async checkConnect(_id: string): Promise<void> {}

  async openedOrders(id: string): Promise<unknown[]> {
    return [...(this.orders.get(id) ?? [])]
  }

  async closedOrders(_id: string): Promise<unknown[]> { return [] }
  async orderHistory(_id: string, _from: string, _to: string): Promise<unknown[]> { return [] }
  async orderHistoryPage(_id: string, _from: string, _to: string, _pageNumber: number, _ordersPerPage = 500): Promise<{ orders: unknown[]; pagesCount: number }> {
    return { orders: [], pagesCount: 1 }
  }
  async historyPositions(_id: string, _from: string, _to: string): Promise<unknown[]> { return [] }
  async closedOrdersHistory(_id: string, _from: string, _to: string): Promise<unknown[]> { return [] }
  async closedOrdersHistoryLite(_id: string, _from: string, _to: string): Promise<unknown[]> { return [] }

  async accountSummary(_id: string): Promise<AccountSummary> {
    return { balance: 100000, equity: 100000, currency: 'USD' }
  }

  async mtStatus(_id: string): Promise<FxsocketMtStatus> {
    return {
      status: 'connected',
      terminal: { alive: true },
      broker: { connected: true },
      account: { loggedIn: true, tradeAllowed: true },
      bridge: { tradeEaReady: true, symbolsSynced: true },
    }
  }

  async terminalStatus(_id: string): Promise<FxsocketTerminalStatus> {
    return { connected: true, tradeAllowed: true, loggedIn: true }
  }

  async symbolParams(_id: string, symbol: string): Promise<SymbolParams> {
    return {
      symbolName: symbol,
      symbol: { digits: symbol.toUpperCase() === 'XAUUSD' ? 2 : 5, point: symbol.toUpperCase() === 'XAUUSD' ? 0.01 : 0.00001, contractSize: 100000, stopsLevel: 0, freezeLevel: 0 },
      groupParams: { minLot: 0.01, maxLot: 100, lotStep: 0.01 },
    }
  }

  async symbols(_id: string): Promise<unknown[]> {
    return ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY']
  }

  async quote(_id: string, symbol: string): Promise<QuoteResult> {
    return symbol.toUpperCase() === 'XAUUSD'
      ? { symbol, bid: 2400, ask: 2400.2, time: new Date(0).toISOString() }
      : { symbol, bid: 1.1, ask: 1.1002, time: new Date(0).toISOString() }
  }

  async orderSend(id: string, args: OrderSendArgs): Promise<OrderResult> {
    const quote = await this.quote(id, args.symbol)
    const isBuy = !String(args.operation).toLowerCase().includes('sell')
    const result: OrderResult = {
      ticket: this.nextTicket++,
      openPrice: Number(args.price) > 0 ? Number(args.price) : isBuy ? quote.ask : quote.bid,
      stopLoss: args.stoploss ?? undefined,
      takeProfit: args.takeprofit ?? undefined,
      lots: args.volume,
      symbol: args.symbol,
      orderType: args.operation,
      state: 'simulated',
      comment: args.comment ?? 'load_test_simulated',
    }
    const list = this.orders.get(id) ?? []
    list.push(result)
    this.orders.set(id, list)
    return result
  }

  async orderModify(id: string, args: OrderModifyArgs): Promise<OrderResult> {
    const list = this.orders.get(id) ?? []
    const found = list.find(order => order.ticket === args.ticket)
    if (found) {
      found.stopLoss = args.stoploss ?? found.stopLoss
      found.takeProfit = args.takeprofit ?? found.takeProfit
      return found
    }
    return {
      ticket: args.ticket,
      stopLoss: args.stoploss ?? undefined,
      takeProfit: args.takeprofit ?? undefined,
      state: 'simulated_modify',
    }
  }

  async orderClose(id: string, args: { ticket: number }): Promise<OrderResult> {
    const list = this.orders.get(id) ?? []
    const idx = list.findIndex(order => order.ticket === args.ticket)
    const [closed] = idx >= 0 ? list.splice(idx, 1) : []
    this.orders.set(id, list)
    return {
      ticket: args.ticket,
      state: 'simulated_close',
      closePrice: closed?.openPrice,
      symbol: closed?.symbol,
      lots: closed?.lots,
    }
  }
}
