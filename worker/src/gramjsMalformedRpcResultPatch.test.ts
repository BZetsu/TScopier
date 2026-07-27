import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const requireFromTest = createRequire(__filename)

type FakeState = {
  msgId: bigint
  request: { className: string; readResult: (reader: { readInt: (signed?: boolean) => number }) => unknown }
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

function loadSender(): { MTProtoSender: { prototype: { _handleRPCResult: (message: unknown) => void } } } {
  return requireFromTest('../node_modules/telegram/network/MTProtoSender.js') as {
    MTProtoSender: { prototype: { _handleRPCResult: (message: unknown) => void } }
  }
}

function makeSender(state: FakeState | null, warnings: string[] = []) {
  return {
    _pendingState: {
      getAndDelete: () => state,
    },
    _log: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
    },
    _sendQueue: {
      append: () => {},
    },
  }
}

function makeState() {
  let resolved: unknown
  let rejected: unknown
  const state: FakeState = {
    msgId: 123n,
    request: {
      className: 'FakeRequest',
      readResult: reader => reader.readInt(false),
    },
    resolve: value => { resolved = value },
    reject: err => { rejected = err },
  }
  return { state, get resolved() { return resolved }, get rejected() { return rejected } }
}

describe('patched GramJS MTProtoSender RPC body handling', () => {
  it('valid body decodes normally', () => {
    const { MTProtoSender } = loadSender()
    const holder = makeState()
    const body = Buffer.alloc(4)
    body.writeUInt32LE(0x12345678, 0)

    MTProtoSender.prototype._handleRPCResult.call(makeSender(holder.state), {
      obj: { reqMsgId: 1n, body },
    })

    assert.equal(holder.resolved, 0x12345678)
    assert.equal(holder.rejected, undefined)
  })

  it('empty body is rejected before BinaryReader', () => {
    const { MTProtoSender } = loadSender()
    const holder = makeState()
    const warnings: string[] = []

    assert.throws(
      () => MTProtoSender.prototype._handleRPCResult.call(makeSender(holder.state, warnings), {
        obj: { reqMsgId: 1n, body: Buffer.alloc(0) },
      }),
      /GRAMJS_MALFORMED_RPC_RESULT/,
    )
    assert.match(String((holder.rejected as Error).message), /GRAMJS_MALFORMED_RPC_RESULT/)
    assert.equal(warnings.some(w => w.includes('type=buffer') && w.includes('length=0')), true)
  })

  it('undefined body is rejected before BinaryReader', () => {
    const { MTProtoSender } = loadSender()
    const holder = makeState()

    assert.throws(
      () => MTProtoSender.prototype._handleRPCResult.call(makeSender(holder.state), {
        obj: { reqMsgId: 1n, body: undefined },
      }),
      /type=undefined/,
    )
  })

  it('normal RPCError handling remains unchanged', () => {
    const { MTProtoSender } = loadSender()
    const holder = makeState()

    assert.throws(
      () => MTProtoSender.prototype._handleRPCResult.call(makeSender(holder.state), {
        obj: {
          reqMsgId: 1n,
          error: { errorMessage: 'FLOOD_WAIT_3', errorCode: 420 },
          body: undefined,
        },
      }),
      /wait of 3 seconds|FloodWait/i,
    )
    assert.match(String((holder.rejected as Error).message), /wait of 3 seconds|FloodWait/i)
  })

  it('safe malformed warnings do not include session strings', () => {
    const { MTProtoSender } = loadSender()
    const holder = makeState()
    const warnings: string[] = []
    const sessionLike = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    assert.throws(
      () => MTProtoSender.prototype._handleRPCResult.call(makeSender(holder.state, warnings), {
        obj: { reqMsgId: 1n, body: sessionLike },
      }),
      /GRAMJS_MALFORMED_RPC_RESULT/,
    )
    assert.equal(warnings.join('\n').includes(sessionLike), false)
    assert.match(warnings.join('\n'), /type=string/)
  })

  it('patch check passes after install patching', () => {
    const result = spawnSync(process.execPath, ['scripts/apply-node-module-patches.cjs', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
})
