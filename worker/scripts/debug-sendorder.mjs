import fs from 'fs'
const srcPath = 'src/tradeExecutor/TradeExecutor.ts'
let src = fs.readFileSync(srcPath, 'utf8')
const phase1Header = `/* phase1 */\nexport class TradeExecutor {`
const cutStart = src.indexOf('/** When true (default), channel-attached')
const classStart = src.indexOf('export class TradeExecutor')
src = src.slice(0, cutStart) + phase1Header + '\n' + src.slice(classStart + 'export class TradeExecutor'.length)

function findMethodBodyBrace(startIdx) {
  let i = src.indexOf('(', startIdx)
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  let k = i
  while (k < src.length && /\s/.test(src[k])) k++
  if (src[k] === ':') {
    k++
    while (k < src.length && /\s/.test(src[k])) k++
    if (src.slice(k, k + 7) === 'Promise') {
      k += 7
      while (k < src.length && /\s/.test(src[k])) k++
      if (src[k] === '<') {
        let d = 1
        k++
        while (k < src.length && d > 0) {
          if (src[k] === '<') d++
          else if (src[k] === '>') d--
          k++
        }
      }
    } else {
      while (k < src.length && src[k] !== '{') k++
    }
  }
  while (k < src.length && /\s/.test(src[k])) k++
  return src[k] === '{' ? k : -1
}

const start = src.indexOf('  private async sendOrder(')
console.log('start', start)
console.log('brace', findMethodBodyBrace(start))
console.log('after params', src.slice(start, start + 200))
