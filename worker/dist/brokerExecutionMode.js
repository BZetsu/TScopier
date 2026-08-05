"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FxsocketNoSendSimulator = void 0;
exports.buildBrokerExecutionCapability = buildBrokerExecutionCapability;
exports.initializeBrokerExecutionCapability = initializeBrokerExecutionCapability;
exports.getBrokerExecutionCapability = getBrokerExecutionCapability;
exports.isBrokerSimulatorEnforced = isBrokerSimulatorEnforced;
exports.resetBrokerExecutionCapabilityForTests = resetBrokerExecutionCapabilityForTests;
let selectedCapability = null;
function envBool(raw) {
    return String(raw ?? '').trim().toLowerCase() === 'true';
}
function safeEnvironment(env) {
    return String(env.NODE_ENV ?? 'production').trim().toLowerCase() || 'production';
}
function assertNoLiveBrokerCredentials(env) {
    const liveCredentialVars = [
        'FXSOCKET_API_KEY',
        'FXSOCKET_BASE_URL',
        'MT4API_BASIC_USER',
        'MT4API_BASIC_PASSWORD',
        'BROKER_PASSWORD',
        'BROKER_LOGIN',
    ];
    const present = liveCredentialVars.filter(name => String(env[name] ?? '').trim());
    if (present.length > 0) {
        throw new Error(`Broker simulator mode refuses live broker credential variables: ${present.join(', ')}`);
    }
}
function buildBrokerExecutionCapability(env = process.env) {
    const loadTest = envBool(env.LOAD_TEST_MODE);
    const simulatorRequested = envBool(env.BROKER_SIMULATOR_MODE);
    const environment = safeEnvironment(env);
    if (simulatorRequested && environment === 'production') {
        throw new Error('BROKER_SIMULATOR_MODE=true is not allowed with NODE_ENV=production');
    }
    if (loadTest && !simulatorRequested) {
        throw new Error('LOAD_TEST_MODE=true requires BROKER_SIMULATOR_MODE=true');
    }
    if (simulatorRequested && !loadTest) {
        throw new Error('BROKER_SIMULATOR_MODE=true requires LOAD_TEST_MODE=true');
    }
    if (simulatorRequested) {
        assertNoLiveBrokerCredentials(env);
        return Object.freeze({
            load_test_enabled: true,
            broker_mode: 'simulator',
            live_broker_execution_enabled: false,
            simulator_enforced: true,
            environment,
        });
    }
    return Object.freeze({
        load_test_enabled: false,
        broker_mode: 'live',
        live_broker_execution_enabled: true,
        simulator_enforced: false,
        environment,
    });
}
function initializeBrokerExecutionCapability(env = process.env) {
    selectedCapability = buildBrokerExecutionCapability(env);
    return selectedCapability;
}
function getBrokerExecutionCapability() {
    if (!selectedCapability)
        selectedCapability = buildBrokerExecutionCapability();
    return selectedCapability;
}
function isBrokerSimulatorEnforced() {
    const cap = getBrokerExecutionCapability();
    return cap.broker_mode === 'simulator'
        && cap.simulator_enforced === true
        && cap.live_broker_execution_enabled === false;
}
function resetBrokerExecutionCapabilityForTests() {
    selectedCapability = null;
}
class FxsocketNoSendSimulator {
    constructor() {
        this.simulated = true;
        this.nextTicket = 900000;
        this.orders = new Map();
        this.platformCache = new Map();
    }
    seedPlatformCache(id, platform) {
        this.platformCache.set(String(id), platform);
    }
    async connectEx(args) {
        return String(args.id || `sim-${this.nextTicket++}`);
    }
    async connectByToken(_id) { }
    async ensureConnected(_id) { }
    async keepSessionAlive(_id) { return true; }
    async keepSessionAliveDetailed(_id) { return 'alive'; }
    async verifyTradingReady(_id) { return true; }
    async disconnect(_id) { }
    async checkConnect(_id) { }
    async openedOrders(id) {
        return [...(this.orders.get(id) ?? [])];
    }
    async closedOrders(_id) { return []; }
    async orderHistory(_id, _from, _to) { return []; }
    async orderHistoryPage(_id, _from, _to, _pageNumber, _ordersPerPage = 500) {
        return { orders: [], pagesCount: 1 };
    }
    async historyPositions(_id, _from, _to) { return []; }
    async closedOrdersHistory(_id, _from, _to) { return []; }
    async closedOrdersHistoryLite(_id, _from, _to) { return []; }
    async accountSummary(_id) {
        return { balance: 100000, equity: 100000, currency: 'USD' };
    }
    async mtStatus(_id) {
        return {
            status: 'connected',
            terminal: { alive: true },
            broker: { connected: true },
            account: { loggedIn: true, tradeAllowed: true },
            bridge: { tradeEaReady: true, symbolsSynced: true },
        };
    }
    async terminalStatus(_id) {
        return { connected: true, tradeAllowed: true, loggedIn: true };
    }
    async symbolParams(_id, symbol) {
        return {
            symbolName: symbol,
            symbol: { digits: symbol.toUpperCase() === 'XAUUSD' ? 2 : 5, point: symbol.toUpperCase() === 'XAUUSD' ? 0.01 : 0.00001, contractSize: 100000, stopsLevel: 0, freezeLevel: 0 },
            groupParams: { minLot: 0.01, maxLot: 100, lotStep: 0.01 },
        };
    }
    async symbols(_id) {
        return ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];
    }
    async quote(_id, symbol) {
        return symbol.toUpperCase() === 'XAUUSD'
            ? { symbol, bid: 2400, ask: 2400.2, time: new Date(0).toISOString() }
            : { symbol, bid: 1.1, ask: 1.1002, time: new Date(0).toISOString() };
    }
    async orderSend(id, args) {
        const quote = await this.quote(id, args.symbol);
        const isBuy = !String(args.operation).toLowerCase().includes('sell');
        const result = {
            ticket: this.nextTicket++,
            openPrice: Number(args.price) > 0 ? Number(args.price) : isBuy ? quote.ask : quote.bid,
            stopLoss: args.stoploss ?? undefined,
            takeProfit: args.takeprofit ?? undefined,
            lots: args.volume,
            symbol: args.symbol,
            orderType: args.operation,
            state: 'simulated',
            comment: args.comment ?? 'load_test_simulated',
        };
        const list = this.orders.get(id) ?? [];
        list.push(result);
        this.orders.set(id, list);
        return result;
    }
    async orderModify(id, args) {
        const list = this.orders.get(id) ?? [];
        const found = list.find(order => order.ticket === args.ticket);
        if (found) {
            found.stopLoss = args.stoploss ?? found.stopLoss;
            found.takeProfit = args.takeprofit ?? found.takeProfit;
            return found;
        }
        return {
            ticket: args.ticket,
            stopLoss: args.stoploss ?? undefined,
            takeProfit: args.takeprofit ?? undefined,
            state: 'simulated_modify',
        };
    }
    async orderClose(id, args) {
        const list = this.orders.get(id) ?? [];
        const idx = list.findIndex(order => order.ticket === args.ticket);
        const [closed] = idx >= 0 ? list.splice(idx, 1) : [];
        this.orders.set(id, list);
        return {
            ticket: args.ticket,
            state: 'simulated_close',
            closePrice: closed?.openPrice,
            symbol: closed?.symbol,
            lots: closed?.lots,
        };
    }
}
exports.FxsocketNoSendSimulator = FxsocketNoSendSimulator;
