#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const workerRoot = process.cwd()
const tradeExecutorRoot = path.join(workerRoot, 'src/tradeExecutor')
const basketMergePath = path.join(tradeExecutorRoot, 'basketMerge.ts')
const folderRoot = path.join(tradeExecutorRoot, 'basketMerge')

const allNames = [
  'hasOpenTradeForSymbol',
  'reconcileGhostBasketLegs',
  'parentSignalIdChainContainsAnchor',
  'resolveBasketAnchorSignalIdForOpenTrades',
  'manualDispatchAlreadyMaterialized',
  'cancelSignalEntryBrokerRowsForScope',
  'cancelRangePendingLegsForScopes',
  'persistRangePendingLegRows',
  'closeOppositeDirectionTrades',
  'loadMergeSignalForLinking',
  'resolveBasketMergeLinkContext',
  'tryParameterFollowUpMergeModifyOnly',
  'syncMultiBasketLegTakeProfits',
  'applyBasketSlTpRefresh',
  'tryMergeSignalIntoExistingOpenTrade',
]

const groups = {
  helpers: [
    'hasOpenTradeForSymbol',
    'reconcileGhostBasketLegs',
    'parentSignalIdChainContainsAnchor',
    'resolveBasketAnchorSignalIdForOpenTrades',
    'manualDispatchAlreadyMaterialized',
    'persistRangePendingLegRows',
    'loadMergeSignalForLinking',
    'resolveBasketMergeLinkContext',
  ],
  pendingCancel: ['cancelSignalEntryBrokerRowsForScope', 'cancelRangePendingLegsForScopes'],
  closeOpposite: ['closeOppositeDirectionTrades'],
  legTpSync: ['syncMultiBasketLegTakeProfits'],
  slTpRefresh: ['applyBasketSlTpRefresh'],
  mergeRouting: ['tryParameterFollowUpMergeModifyOnly', 'tryMergeSignalIntoExistingOpenTrade'],
}

function findBodyBrace(monolith, startIdx) {
  let i = monolith.indexOf('(', startIdx)
  let depth = 0
  for (; i < monolith.length; i++) {
    if (monolith[i] === '(') depth++
    else if (monolith[i] === ')') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  let k = i
  while (k < monolith.length && /\s/.test(monolith[k])) k++
  if (monolith[k] === ':') {
    k++
    while (k < monolith.length && /\s/.test(monolith[k])) k++
    if (monolith.slice(k, k + 7) === 'Promise') {
      k += 7
      while (k < monolith.length && /\s/.test(monolith[k])) k++
      if (monolith[k] === '<') {
        let d = 1
        k++
        while (k < monolith.length && d > 0) {
          if (monolith[k] === '<') d++
          else if (monolith[k] === '>') d--
          k++
        }
      }
    } else {
      while (k < monolith.length && monolith[k] !== '{') k++
    }
  }
  while (k < monolith.length && /\s/.test(monolith[k])) k++
  return monolith[k] === '{' ? k : -1
}

function extractClassMethod(monolith, name) {
  const sigRe = new RegExp(`^  (?:private async |private )${name}\\(`, 'm')
  const m = monolith.match(sigRe)
  if (!m) return null
  const bodyBrace = findBodyBrace(monolith, m.index)
  if (bodyBrace < 0) return null
  let depth = 0
  let j = bodyBrace
  for (; j < monolith.length; j++) {
    if (monolith[j] === '{') depth++
    else if (monolith[j] === '}') {
      depth--
      if (depth === 0) {
        j++
        break
      }
    }
  }
  let t = monolith.slice(m.index, j)
  t = t
    .replace(/^  private async /, 'export async function ')
    .replace(/^  private /, 'export function ')
  t = t.replace(/^(export (?:async )?function \w+)\(/, '$1(ctx: TradeExecutorContext, ')
  t = t.replace(/\bthis\./g, 'ctx.')
  return t
}

function extractStandaloneFn(src, name) {
  const re = new RegExp(`^export async function ${name}\\(`, 'm')
  const m = src.match(re)
  if (!m) return null
  const bodyBrace = findBodyBrace(src, m.index)
  if (bodyBrace < 0) return null
  let depth = 0
  let j = bodyBrace
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) {
        j++
        break
      }
    }
  }
  return src.slice(m.index, j)
}

const TRADE_EXECUTOR_TAIL = `import type { TradeExecutorContext } from '../context'
import type {
  BrokerRow,
  MergeOutcome,
  ParsedSignal,
  RangePendingCancelScope,
  SignalRow,
  SymbolCacheEntry,
} from '../types'
import { computeCweTp, roundLot, triggerPriceFor } from '../helpers'
`

function monolithHeaderToImports(header, workerPrefix) {
  return (
    header.replace(/from '\.\//g, `from '${workerPrefix}`) + '\n' + TRADE_EXECUTOR_TAIL
  )
}

function restoreFromMonolith(monolithSrc) {
  const importEnd = monolithSrc.indexOf('/** When true (default), channel-attached')
  const header = monolithHeaderToImports(monolithSrc.slice(0, importEnd).trim(), '../')
  const fns = []
  for (const name of allNames) {
    const fn = extractClassMethod(monolithSrc, name)
    if (!fn) throw new Error(`missing monolith method ${name}`)
    fns.push(fn)
  }
  return `${header}\n\n${fns.join('\n\n')}\n`
}

const repoRoot = path.join(workerRoot, '..')
const monolith = execSync('git show HEAD:worker/src/tradeExecutor.ts', {
  cwd: repoRoot,
  encoding: 'utf8',
})
const monolithImportEnd = monolith.indexOf('/** When true (default), channel-attached')
if (monolithImportEnd < 0) throw new Error('monolith import marker not found')
const SHARED = monolithHeaderToImports(monolith.slice(0, monolithImportEnd).trim(), '../../')

let src = restoreFromMonolith(monolith)
const importEnd = src.indexOf('export async function hasOpenTradeForSymbol')
if (importEnd < 0) throw new Error('hasOpenTradeForSymbol not found after restore')

fs.mkdirSync(folderRoot, { recursive: true })

for (const [file, names] of Object.entries(groups)) {
  const fns = names.map(n => extractStandaloneFn(src, n)).filter(Boolean)
  if (fns.length !== names.length) {
    throw new Error(`${file}: expected ${names.length} functions, got ${fns.length}`)
  }
  let body = fns.join('\n\n')
  if (file === 'mergeRouting') {
    body = body
      .replace(/ctx\.applyBasketSlTpRefresh\(/g, 'applyBasketSlTpRefresh(ctx, ')
      .replace(/ctx\.reconcileGhostBasketLegs\(/g, 'reconcileGhostBasketLegs(ctx, ')
      .replace(/ctx\.resolveBasketMergeLinkContext\(/g, 'resolveBasketMergeLinkContext(ctx, ')
      .replace(/ctx\.loadMergeSignalForLinking\(/g, 'loadMergeSignalForLinking(ctx, ')
  }
  if (file === 'slTpRefresh') {
    body = body
      .replace(/ctx\.cancelRangePendingLegsForScopes\(/g, 'cancelRangePendingLegsForScopes(ctx, ')
      .replace(/ctx\.persistRangePendingLegRows\(/g, 'persistRangePendingLegRows(ctx, ')
      .replace(
        /persistRows: \(rows, ctx\) => persistRangePendingLegRows\(ctx, rows, ctx\)/,
        'persistRows: (rows, persistCtx) => persistRangePendingLegRows(ctx, rows, persistCtx)',
      )
  }
  if (file === 'closeOpposite') {
    body = body.replace(
      /ctx\.cancelRangePendingLegsForScopes\(/g,
      'cancelRangePendingLegsForScopes(ctx, ',
    )
  }
  let extra = ''
  if (file === 'mergeRouting') {
    extra = `import { applyBasketSlTpRefresh } from './slTpRefresh'
import {
  reconcileGhostBasketLegs,
  loadMergeSignalForLinking,
  resolveBasketMergeLinkContext,
} from './helpers'
`
  }
  if (file === 'slTpRefresh') {
    extra = `import { cancelRangePendingLegsForScopes } from './pendingCancel'
import { persistRangePendingLegRows } from './helpers'
`
  }
  if (file === 'closeOpposite') {
    extra = `import { cancelRangePendingLegsForScopes } from './pendingCancel'\n`
  }
  fs.writeFileSync(path.join(folderRoot, `${file}.ts`), SHARED + '\n' + extra + '\n' + body + '\n')
  console.log(file, fns.length, 'functions', body.split('\n').length, 'body lines')
}

const index = `export * from './helpers'
export * from './pendingCancel'
export * from './closeOpposite'
export * from './legTpSync'
export * from './slTpRefresh'
export * from './mergeRouting'
`
fs.writeFileSync(path.join(folderRoot, 'index.ts'), index)
fs.writeFileSync(basketMergePath, "export * from './basketMerge/index'\n")
console.log('wrote basketMerge/ and shim')
