import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withMtServerSessionLock } from './mtServerSessionLock'

describe('withMtServerSessionLock', () => {
  it('runs ConnectEx-style work sequentially per server', async () => {
    const order: string[] = []
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    const a = withMtServerSessionLock('MT5', 'ICMarketsSC-Demo', async () => {
      order.push('a-start')
      await delay(30)
      order.push('a-end')
    })
    const b = withMtServerSessionLock('MT5', 'ICMarketsSC-Demo', async () => {
      order.push('b-start')
      await delay(10)
      order.push('b-end')
    })

    await Promise.all([a, b])
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('does not block different servers', async () => {
    const order: string[] = []
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    await Promise.all([
      withMtServerSessionLock('MT5', 'Server-A', async () => {
        order.push('a-start')
        await delay(40)
        order.push('a-end')
      }),
      withMtServerSessionLock('MT5', 'Server-B', async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])

    assert.equal(order[0], 'a-start')
    assert.equal(order[1], 'b-start')
  })
})
