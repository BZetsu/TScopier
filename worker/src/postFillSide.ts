/** Side for post-fill SL/TP restamp: ticket first, then reverse-aware parse fallback. */
export function resolvePostFillIsBuy(args: {
  direction?: string | null
  parsedAction?: string | null
  reverse?: boolean
}): boolean {
  const dir = String(args.direction ?? '').toLowerCase()
  if (dir === 'buy') return true
  if (dir === 'sell') return false
  const parsedIsBuy = !String(args.parsedAction ?? '').toLowerCase().includes('sell')
  return args.reverse === true ? !parsedIsBuy : parsedIsBuy
}
