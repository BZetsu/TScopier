import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBrokerExecutionCapability,
  getBrokerExecutionCapability,
  initializeBrokerExecutionCapability,
  resetBrokerExecutionCapabilityForTests,
} from './brokerExecutionMode'
import { getFxsocketClient, resetFxsocketClientForTests } from './fxsocketClient'
import { getFxClient, resetFxClientForTests } from './engine/fxClient'

function reset() {
  resetBrokerExecutionCapabilityForTests()
  resetFxsocketClientForTests()
  resetFxClientForTests()
}

test.afterEach(reset)

test('contradictory load-test configuration fails startup', () => {
  assert.throws(() => buildBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    NODE_ENV: 'staging',
  } as NodeJS.ProcessEnv), /requires BROKER_SIMULATOR_MODE=true/)
})

test('simulator mode refuses live broker credentials', () => {
  assert.throws(() => buildBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    BROKER_SIMULATOR_MODE: 'true',
    NODE_ENV: 'staging',
    FXSOCKET_API_KEY: 'present',
  } as NodeJS.ProcessEnv), /refuses live broker credential/)
})

test('simulator mode is not allowed in production environment', () => {
  assert.throws(() => buildBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    BROKER_SIMULATOR_MODE: 'true',
    NODE_ENV: 'production',
  } as NodeJS.ProcessEnv), /NODE_ENV=production/)
})

test('health capability reflects initialized simulator enforcement', () => {
  const capability = initializeBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    BROKER_SIMULATOR_MODE: 'true',
    NODE_ENV: 'staging',
  } as NodeJS.ProcessEnv)
  assert.deepEqual(getBrokerExecutionCapability(), {
    load_test_enabled: true,
    broker_mode: 'simulator',
    live_broker_execution_enabled: false,
    simulator_enforced: true,
    environment: 'staging',
  })
  assert.equal(capability.broker_mode, 'simulator')
})

test('simulator mode uses no-send fxsocket adapter without credentials', async () => {
  initializeBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    BROKER_SIMULATOR_MODE: 'true',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv)
  const api = getFxsocketClient()
  assert.ok(api)
  const order = await api!.orderSend('sim-account', {
    symbol: 'XAUUSD',
    operation: 'Buy',
    volume: 0.01,
  })
  assert.equal(order.state, 'simulated')
  const orders = await api!.openedOrders('sim-account')
  assert.equal(orders.length, 1)
})

test('v2 client also uses simulator transport in simulator mode', async () => {
  initializeBrokerExecutionCapability({
    LOAD_TEST_MODE: 'true',
    BROKER_SIMULATOR_MODE: 'true',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv)
  const fx = getFxClient()
  const result = await fx.orderSend('sim-account', 'MT5', {
    symbol: 'EURUSD',
    operation: 'Buy',
    volume: 0.01,
  }, { anchorSignalId: 'loadtest_signal_abc_000001', legIndex: 0, preSnapshot: [] })
  assert.equal(result.ok, true)
  const orders = await fx.openedOrders('sim-account', 'MT5')
  assert.equal(orders.length, 1)
})

test('production mode still selects live capability', () => {
  const capability = buildBrokerExecutionCapability({
    NODE_ENV: 'production',
  } as NodeJS.ProcessEnv)
  assert.deepEqual(capability, {
    load_test_enabled: false,
    broker_mode: 'live',
    live_broker_execution_enabled: true,
    simulator_enforced: false,
    environment: 'production',
  })
})
