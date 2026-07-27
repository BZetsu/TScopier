const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const senderPath = path.join(root, 'node_modules', 'telegram', 'network', 'MTProtoSender.js')

const helperAnchor = 'var MsgsAck = tl_1.Api.MsgsAck;\n'
const helperPatch = `var MsgsAck = tl_1.Api.MsgsAck;
const MALFORMED_RPC_RESULT_ERROR = "GRAMJS_MALFORMED_RPC_RESULT";
function rpcBodyKind(body) {
    if (body === undefined) {
        return "undefined";
    }
    if (body === null) {
        return "null";
    }
    if (Buffer.isBuffer(body)) {
        return "buffer";
    }
    if (body instanceof Uint8Array) {
        return "uint8array";
    }
    return typeof body;
}
function rpcBodyLength(body) {
    return body && typeof body.length === "number" ? body.length : undefined;
}
function malformedRpcResultError(result, state) {
    const err = new Error(\`\${MALFORMED_RPC_RESULT_ERROR}: invalid RPC result body type=\${rpcBodyKind(result && result.body)} length=\${rpcBodyLength(result && result.body) ?? "n/a"} req_msg_id=\${result && result.reqMsgId ? result.reqMsgId : "unknown"} pending=\${state ? "yes" : "no"}\`);
    err.name = "MalformedRpcResultError";
    err.code = MALFORMED_RPC_RESULT_ERROR;
    return err;
}
function rpcResultBodyOrThrow(result, state, log) {
    const body = result && result.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
        const err = malformedRpcResultError(result, state);
        if (log && typeof log.warn === "function") {
            log.warn(\`[telegram] \${err.message}\`);
        }
        throw err;
    }
    return body;
}
`

const oldUnmatched = '                const reader = new extensions_1.BinaryReader(result.body);\n'
const newUnmatched = '                const body = rpcResultBodyOrThrow(result, state, this._log);\n                const reader = new extensions_1.BinaryReader(body);\n'

const oldMatched = '                const reader = new extensions_1.BinaryReader(result.body);\n                const read = state.request.readResult(reader);\n'
const newMatched = '                const body = rpcResultBodyOrThrow(result, state, this._log);\n                const reader = new extensions_1.BinaryReader(body);\n                const read = state.request.readResult(reader);\n'

function fail(message) {
  console.error(`[patch-node-modules] ${message}`)
  process.exit(1)
}

function applyPatch({ checkOnly = false } = {}) {
  if (!fs.existsSync(senderPath)) {
    fail(`Missing ${senderPath}; run npm install in worker first.`)
  }

  let source = fs.readFileSync(senderPath, 'utf8')
  const alreadyPatched = source.includes('GRAMJS_MALFORMED_RPC_RESULT')
    && source.includes('rpcResultBodyOrThrow(result, state, this._log)')

  if (alreadyPatched) {
    console.log('[patch-node-modules] telegram MTProtoSender malformed RPC body guard already applied')
    return
  }
  if (checkOnly) {
    fail('telegram MTProtoSender malformed RPC body guard is not applied')
  }

  if (!source.includes(helperAnchor)) fail('MTProtoSender helper insertion anchor not found')
  if (!source.includes(oldMatched)) fail('MTProtoSender matched RPC BinaryReader site not found')
  const unmatchedCount = source.split(oldUnmatched).length - 1
  if (unmatchedCount < 2) fail('MTProtoSender RPC BinaryReader sites not found')

  source = source.replace(helperAnchor, helperPatch)
  source = source.replace(oldMatched, newMatched)
  source = source.replace(oldUnmatched, newUnmatched)

  fs.writeFileSync(senderPath, source)
  console.log('[patch-node-modules] applied telegram MTProtoSender malformed RPC body guard')
}

applyPatch({ checkOnly: process.argv.includes('--check') })
